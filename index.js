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
async function generateQuiz(subject, topic, subTopic, difficulty, numQuestions = 5) {
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
  const result = await model.generateContent(prompt);
  const response = await result.response;
  let quizData = response.text();

  // Clean up JSON format
  quizData = quizData.replace(/```json|```/g, "").trim();

  return JSON.parse(quizData);
}


async function run() {
  try {
    await client.connect();
    const quizzesCollection = client.db("quizGenius").collection("quizzes");

    // 🔹 API Route to Generate a Quiz
    app.get("/quizzes", async (req, res) => {
     
        const {
          selectedSubject,
          selectedTopic = "",
          subTopics = "",
          numOfQuestions = 5,
          levelOfQuestions = "Intermediate",
        } = req.query;
    
        const quizData = await generateQuiz(
          selectedSubject,
          selectedTopic,
          subTopics,
          levelOfQuestions,
          numOfQuestions
        );

        // const result = await quizzesCollection.insertMany(quizData) 
        console.log(quizData)
       
      res.send(quizData);
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
