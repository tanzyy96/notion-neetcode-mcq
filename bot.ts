import express from "express";
import { Db } from "./db";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const sendTelegramMessage = async (text: string) => {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error("Telegram bot token or chat ID is not defined.");
    return;
  }

  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: "Markdown",
      }),
    });
  } catch (error) {
    console.error("Error sending message to Telegram:", error);
  }
};

const handleAnswer = async (
  answer: string,
  questionId: string,
  callback: any,
) => {
  // Check correctness against sqlite
  const db = new Db();

  try {
    const { question, correct: isCorrect } = db.recordAttempt(
      questionId,
      answer,
    );

    let message;
    if (isCorrect) {
      message = "Correct! 🎉";
    } else {
      message = `Incorrect. 😞\n\n*Question:*\n${question.question}\n\n*Your Answer:*\n${answer}\n\n*Correct Answer:*\n${question.correct_answer}\n\n*Explanation:*\n${question.explanation}`;
    }
    sendTelegramMessage(message);
  } catch (error) {
    console.error("Error recording attempt:", error);
    await sendTelegramMessage(
      "An error occurred while recording your answer. Please try again.",
    );
    return;
  }
};

// Removes spinning state after clicking answer
const answerCallbackQuery = async (callbackId: string) => {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query_id: callbackId,
    }),
  });
};

// Removes inline keyboard and adds selected answer to the message
const removeInlineKeyboard = async (callback: any, answer: string) => {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: callback.message.chat.id,
      message_id: callback.message.message_id,
      text: `${callback.message.text}\n\n*You selected:*\n${answer}`,
      parse_mode: "Markdown",
    }),
  });
};

app.post("/telegram-webhook", async (req, res) => {
  const callback = req.body.callback_query;

  if (!callback) return res.sendStatus(200);

  const [type, answer, questionId] = callback.data.split(":");

  await answerCallbackQuery(callback.id);
  await removeInlineKeyboard(callback, answer);

  await handleAnswer(answer, questionId, callback);

  res.sendStatus(200);
});

console.log("Listening on port 3000");
app.listen(3000);
