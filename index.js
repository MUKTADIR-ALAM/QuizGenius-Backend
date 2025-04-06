require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 5000;
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:5000"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);

// Middleware
app.use(express.json());

// MongoDB Connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.cd15p.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: false,
    deprecationErrors: true,
  },
});

// Generate quiz using Gemini API
async function generateQuiz(
  subject,
  topic,
  subTopic,
  difficulty,
  numQuestions = 5
) {
  let category = subject;

  if (topic) category += `, Topic: ${topic}`;
  if (subTopic) category += `, Sub-topic: ${subTopic}`;

  const prompt = `
  Generate ${numQuestions} multiple-choice quiz questions on the subject "${subject}".
  ${topic ? `Focus on the topic: "${topic}".` : ""}
  ${subTopic ? `Drill down into the sub-topic: "${subTopic}".` : ""}
  
  Each question should:
  - Have 4 answer options.
  - Clearly indicate the correct answer.
  - Be at a "${difficulty}" difficulty level.
  - Be formatted as a JSON array like this:

  [
    {
      "question": "What is the limit of (sin x)/x as x approaches 0?",
      "options": ["1", "0", "Infinity", "-1"],
      "correctAnswer": "1"
    }
  ]
  `;

  console.log("Sending request to Gemini API...");
  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.8,
      top_p: 0.9,
      max_output_tokens: 500,
    },
  });
  const response = await result.response;
  let quizData = response.text();

  // Clean up JSON format
  quizData = quizData.replace(/```json|```/g, "").trim();

  return JSON.parse(quizData);
}

// Generate lesson using Gemini AI
async function generateLesson(subject, topic, subTopic, levelOfQuestions) {
  let category = subject;

  if (topic) category += `, Topic: ${topic}`;
  if (subTopic) category += `, Sub-topic: ${subTopic}`;

  const prompt = `
  Generate a structured lesson on the subject "${subject}".
  ${topic ? `Include topic: "${topic}".` : ""}
  ${subTopic ? `Focus on sub-topic: "${subTopic}".` : ""}
  ${levelOfQuestions ? `Difficulty level: "${levelOfQuestions}".` : ""}
  
  The lesson should be formatted as valid JSON:
  {
    "title": "Lesson Title",
    "subject":"Mathematics",
    "topic":"Algebra"
    "introduction": "Brief introduction...",
    "objectives": ["Objective 1", "Objective 2"],
    "sections": [
      {
        "heading": "Section 1 Heading",
        "content": "Detailed content for section 1."
      },
      {
        "heading": "Section 2 Heading",
        "content": "Detailed content for section 2."
      }
    ],
    "conclusion": "Summary of the lesson..."
  }
  Only return JSON, no additional text.
  `;

  console.log("Sending request for creating lessons to Gemini API...");
  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.8,
      top_p: 0.9,
      max_output_tokens: 500,
    },
  });
  console.log(result);
  let lessonText = result.response
    .text()
    .replace(/```json|```/g, "")
    .trim();

  return lessonText;
}

async function run() {
  try {
    await client.connect();
    const quizzesCollection = client.db("quizGenius").collection("quizzes");
    const lessonsCollection = client.db("quizGenius").collection("lessons");

    // 🔹 API Route to Generate a Quiz
    app.get("/quizzes", async (req, res) => {
      const {
        selectedSubject,
        selectedTopic = "",
        subTopics = "",
        numOfQuestions = 5,
        levelOfQuestions = "Intermediate",
      } = req.query;

      // const existingQuiz = await quizzesCollection.findOne({
      //   subject: selectedSubject,
      //   topic: selectedTopic,
      //   subTopic: subTopics,
      //   difficulty: levelOfQuestions,
      // });

      // if (existingQuiz) {
      //   console.log("Returning cached quiz from MongoDB...");
      //   return res.send(existingQuiz.questions);
      // }
      const quizData = await generateQuiz(
        selectedSubject,
        selectedTopic,
        subTopics,
        levelOfQuestions,
        numOfQuestions
      );

      // const newQuiz = {
      //   subject: selectedSubject,
      //   topic: selectedTopic,
      //   subTopic: subTopics,
      //   difficulty: levelOfQuestions,
      //   questions: quizData,
      //   createdAt: new Date(),
      // };

      // await quizzesCollection.insertOne(newQuiz);
      res.send(quizData);
    });

    // Generate Lessons
    app.post("/lessons", async (req, res) => {
      const {
        selectedSubject,
        topics = "",
        subTopics = "",
        levelOfQuestions,
      } = req.body;

      const lessonData = JSON.parse(
        await generateLesson(
          selectedSubject,
          topics,
          subTopics,
          levelOfQuestions
        )
      );

      // Insert into DB
      const insertedLesson = await lessonsCollection.insertOne(lessonData);
      res.send(insertedLesson);
    });

    app.get("/lessons", async (req, res) => {
      const result = await lessonsCollection.find().toArray();

      res.send(result);
    });

    console.log("Connected to MongoDB!");
  } catch (error) {
    console.error("MongoDB Connection Error:", error);
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Quiz Server is running");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
