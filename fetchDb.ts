import { Client, isFullPage } from "@notionhq/client";
import _ from "lodash";
import dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import z from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as fs from "fs";
import { nanoid } from "nanoid";
import { Db } from "./db";
import { sleep } from "./utils";

dotenv.config();

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface LeetcodeQuestion {
  id: string;
  name: string;
  tags: string;
  difficulty: string | undefined;
  recentlyAttempted: boolean;
}

const McqQuestionSchema = z.object({
  question: z.string(),
  leetcode_description: z.string(),
  options: z.array(
    z.object({
      content: z.string(),
      is_correct: z.boolean(),
    }),
  ),
  explanation: z.string(),
});

type McqQuestion = z.infer<typeof McqQuestionSchema> & {
  id: string;
};

const DATABASE_ID = process.env.DATABASE_ID;

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

async function fetchQuestions(
  databaseId = DATABASE_ID,
): Promise<LeetcodeQuestion[]> {
  if (!databaseId) {
    throw new Error("DATABASE_ID is not defined in environment variables.");
  }

  try {
    const response = await notion.dataSources.query({
      data_source_id: databaseId,
    });

    return response.results.map((result) => {
      if (!isFullPage(result)) {
        throw new Error(`Unexpected result format: ${JSON.stringify(result)}`);
      }
      const name =
        result.properties.Name.type == "title"
          ? result.properties.Name.title?.[0]?.plain_text
          : "unknownTitle";
      const tags =
        result.properties.Tags.type == "multi_select"
          ? result.properties.Tags.multi_select
              .map((tag) => tag.name)
              .join(", ")
          : "unknownTags";
      const difficulty =
        result.properties.Select.type == "select"
          ? result.properties.Select.select?.name
          : undefined;
      const recentlyAttempted =
        result.properties.RevisedFor2026.type == "checkbox"
          ? result.properties.RevisedFor2026.checkbox
          : false;

      return {
        id: result.id,
        name,
        tags,
        difficulty,
        recentlyAttempted,
      };
    });
  } catch (error) {
    console.error("Error fetching database:", error);
    throw error;
  }
}

function selectQuestions(questions: LeetcodeQuestion[], count = 1) {
  return _.sampleSize(
    questions.filter((q) => q.difficulty === "Medium" && q.recentlyAttempted),
    count,
  );
}

async function generateMcqs(
  questions: LeetcodeQuestion[],
): Promise<McqQuestion[]> {
  const mcqs = [];
  for (const { name, tags } of questions) {
    const response = await client.messages.parse({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `Leetcode Question: ${name}. Tags: ${tags}. Generate a MCQ question with 4 options to test my understanding of the approach of the question.`,
        },
      ],
      output_config: {
        format: zodOutputFormat(McqQuestionSchema),
      },
    });

    if (response.parsed_output) {
      mcqs.push({ ...response.parsed_output, id: nanoid() });
    }
  }
  return mcqs;
}

async function saveToNotion(mcqs: z.infer<typeof McqQuestionSchema>[]) {
  for (const mcq of mcqs) {
    try {
      await notion.pages.create({
        parent: { database_id: DATABASE_ID! },
        properties: {
          Name: {
            title: [{ text: { content: mcq.question } }],
          },
          Description: {
            rich_text: [{ text: { content: mcq.leetcode_description } }],
          },
          Options: {
            rich_text: [
              {
                text: {
                  content: mcq.options
                    .map(
                      (opt, idx) =>
                        `${String.fromCharCode(65 + idx)}. ${opt.content} ${
                          opt.is_correct ? "(Correct)" : ""
                        }`,
                    )
                    .join("\n"),
                },
              },
            ],
          },
          Explanation: {
            rich_text: [{ text: { content: mcq.explanation } }],
          },
        },
      });
    } catch (error) {
      console.error("Error saving to Notion:", error);
    }
  }
}

// Append to a local file for now
// TODO: Probably want to save this to some notion db instead
function saveToFile(mcqs: z.infer<typeof McqQuestionSchema>[]) {
  for (let mcq of mcqs) {
    fs.appendFileSync(
      "mcqs.json",
      JSON.stringify(mcq, null, 2) + "\n",
      "utf-8",
    );
  }
}

async function sendTelegramMessage(
  text: string,
  inlineKeyboard?: { text: string; callbackData: string }[][],
) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.error("Telegram bot token or chat ID is not defined.");
    return;
  }

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        ...(inlineKeyboard && {
          reply_markup: {
            inline_keyboard: inlineKeyboard.map((row) =>
              row.map((button) => ({
                text: button.text,
                callback_data: button.callbackData,
              })),
            ),
          },
        }),
      }),
    });
  } catch (error) {
    console.error("Error sending message to Telegram:", error);
  }
}

async function sendToTelegram(mcqs: McqQuestion[]) {
  for (const mcq of mcqs) {
    const originalQuestion = `*Leetcode Question:*\n${mcq.leetcode_description}\n\n`;
    const questionText = `*Question:*\n${mcq.question}\n\n*Options:*\n${mcq.options.map((opt, idx) => `${String.fromCharCode(65 + idx)}. ${opt.content}`).join("\n\n")}`;

    // Send the original question first
    // Then send the MCQ question with options and inline keyboard for answers
    const options = mcq.options.map((_, idx) => {
      const optionLabel = `${String.fromCharCode(65 + idx)}`;
      const option = {
        text: optionLabel,
        callbackData: `answer:${String.fromCharCode(65 + idx)}:${mcq.id}`,
      };

      return [option];
    });

    await sendTelegramMessage(originalQuestion);
    sleep(500); // Seems like Tele can sometimes fail if we send messages too quickly in succession, so adding a small delay
    await sendTelegramMessage(questionText, options);
  }
}

async function saveToDb(db: Db, mcqs: McqQuestion[]) {
  for (const mcq of mcqs) {
    db.insertQuestion({
      id: mcq.id,
      notion_page_id: DATABASE_ID ?? "", // Notion page ID can be added if saved to Notion
      leetcode_question: mcq.leetcode_description,
      question: mcq.question,
      correct_answer: String.fromCharCode(
        65 + mcq.options.findIndex((opt) => opt.is_correct) ?? 26, // This means that Z = something went wrong
      ),
      explanation: mcq.explanation,
    });
  }
}

export const run = async () => {
  const db = new Db();

  const results = await fetchQuestions(DATABASE_ID);
  const questions = selectQuestions(results);

  console.log("Selected Questions:", questions);

  const mcqs = await generateMcqs(questions);
  console.log("Generated ", mcqs.length, " MCQ(s)");
  saveToDb(db, mcqs);
  saveToFile(mcqs);

  await sendToTelegram(mcqs);
};

run();
