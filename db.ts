import Database from "better-sqlite3";

export interface Question {
  id: string;
  notion_page_id: string;
  leetcode_question: string;
  question: string;
  correct_answer: string;
  explanation: string;
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
  }

  insertQuestion(question: {
    id: string;
    notion_page_id: string;
    leetcode_question: string;
    question: string;
    correct_answer: string;
    explanation: string;
  }) {
    const stmt = this.instance.prepare(`
      INSERT INTO questions (id, notion_page_id, leetcode_question, question, correct_answer, explanation)
      VALUES (@id, @notion_page_id, @leetcode_question, @question, @correct_answer, @explanation)
    `);
    stmt.run(question);
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
}
