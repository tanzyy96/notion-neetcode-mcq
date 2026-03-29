import Database from "better-sqlite3";

export interface Question {
  id: string;
  notion_page_id: string;
  leetcode_name: string;
  leetcode_url: string;
  leetcode_question: string;
  question: string;
  correct_answer: string;
  explanation: string;
  options_json: string;
  example: string;
}

export interface QuestionAttempt {
  id: number;
  question_id: string;
  selected_answer: string;
  correct: boolean;
  answered_at: Date;
}

export class Db {
  instance;

  constructor(filename = "questions.db") {
    this.instance = new Database(filename);
    this.init();
  }

  init() {
    this.instance.exec(`
      CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY,
        notion_page_id TEXT,
        leetcode_question TEXT,
        question TEXT,
        correct_answer TEXT,
        explanation TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question_id TEXT,
        selected_answer TEXT,
        correct BOOLEAN,
        answered_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    try {
      this.instance.exec(`ALTER TABLE questions ADD COLUMN options_json TEXT DEFAULT '[]'`);
    } catch {}
    try {
      this.instance.exec(`ALTER TABLE questions ADD COLUMN example TEXT DEFAULT ''`);
    } catch {}
    try {
      this.instance.exec(`ALTER TABLE questions ADD COLUMN leetcode_name TEXT DEFAULT ''`);
    } catch {}
    try {
      this.instance.exec(`ALTER TABLE questions ADD COLUMN leetcode_url TEXT DEFAULT ''`);
    } catch {}
  }

  insertQuestion(question: {
    id: string;
    notion_page_id: string;
    leetcode_name: string;
    leetcode_url: string;
    leetcode_question: string;
    question: string;
    correct_answer: string;
    explanation: string;
    options_json: string;
    example: string;
  }) {
    const stmt = this.instance.prepare(`
      INSERT INTO questions (id, notion_page_id, leetcode_name, leetcode_url, leetcode_question, question, correct_answer, explanation, options_json, example)
      VALUES (@id, @notion_page_id, @leetcode_name, @leetcode_url, @leetcode_question, @question, @correct_answer, @explanation, @options_json, @example)
    `);
    stmt.run(question);
  }

  getRandomQuestion(): { name: string; url: string } | undefined {
    const stmt = this.instance.prepare(`
      SELECT leetcode_name as name, leetcode_url as url
      FROM questions
      WHERE leetcode_name != '' AND leetcode_url != ''
      ORDER BY RANDOM()
      LIMIT 1
    `);
    return stmt.get() as { name: string; url: string } | undefined;
  }

  getQuestionsByLeetcodePageId(notionPageId: string): Question[] {
    const stmt = this.instance.prepare(
      `SELECT * FROM questions WHERE notion_page_id = ? AND options_json IS NOT NULL AND options_json != '[]'`
    );
    return stmt.all(notionPageId) as Question[];
  }

  getQuestion(id: string) {
    const stmt = this.instance.prepare(`SELECT * FROM questions WHERE id = ?`);
    return stmt.get(id) as Question | undefined;
  }

  recordAttempt(questionId: string, selectedAnswer: string) {
    // Retrieve the question to ensure it exists
    // Check against the correct_answer to determine if its correct
    const qn = this.getQuestion(questionId);
    if (!qn) throw new Error("Question not found");

    const correct =
      qn.correct_answer.toLowerCase() === selectedAnswer.toLowerCase() ? 1 : 0;

    const stmt = this.instance.prepare(`
      INSERT INTO attempts (question_id, selected_answer, correct)
      VALUES (?, ?, ?)
    `);
    stmt.run(questionId, selectedAnswer, correct);

    return { question: qn, correct: Boolean(correct) };
  }

  getStreak() {
    const stmt = this.instance.prepare(`
      SELECT correct FROM attempts
      ORDER BY answered_at DESC
    `);
    const attempts = stmt.all() as { correct: number }[];

    let streak = 0;
    for (const attempt of attempts) {
      if (attempt.correct) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }
}
