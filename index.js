require("dotenv").config();
const express = require("express");
const app = express();
const multer = require("multer");
const cors = require("cors");
const { PayvraClient } = require("payvra-sdk");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 5000;
const { GoogleGenerativeAI } = require("@google/generative-ai");
const pdf = require("pdf-parse");
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
const upload = multer({ storage: multer.memoryStorage() });

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
  Generate ${numQuestions} multiple-choice quiz questions for the subject "${subject}"${
    topic ? `, focused on topic "${topic}"` : ""
  }${subTopic ? `, and sub-topic "${subTopic}"` : ""}.
  Difficulty level: "${difficulty}".

  for Difficulty level:
  if beginner-grade 5 to 10 
  if intermediate-grade 10 to 12 
  if hard-grade university level 
  
  Return a **valid, compact, one-line JSON array**.
  ⚠️ DO NOT include:
  - Markdown formatting
  - Code blocks
  - Explanations outside the JSON
  - Line breaks inside string values
  
  Each question must be an object with the following fields:
  - "question": a concise question (in one line, no newlines)
  - "options": an array of 4 options
  - "correctAnswer": one of the options, exactly matching
  - "explanation": a brief explanation of the correct answer
  + "explanation": a short, one-line explanation (no line breaks or special symbols like √)

  The output must look like this:
  [
    {
      "question": "...",
      "options": ["...", "...", "...", "..."],
      "correctAnswer": "...",
      "explanation": "..."
    },
    ...
  ]
  `;
  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.8,
      top_p: 0.9,
      max_output_tokens: 500,
    },
  });

  // Wait for the response and extract the text
  const responseText = await result.response.text();

  function sanitizeGeminiOutput(output) {
    // Remove markdown and newline junk
    let fixed = output.replace(/```json|```/g, "").trim();
    fixed = fixed.replace(/(\r\n|\n|\r)/gm, " ");
    fixed = fixed.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
    fixed = fixed.replace(/√/g, "sqrt");
    fixed = fixed.replace(/[½¼¾⅓⅔⅛⅜⅝⅞]/g, "");

    // Safely truncate to the last complete question object
    const lastClosingBrace = fixed.lastIndexOf("}");
    const lastClosingBracket = fixed.lastIndexOf("]");
    const validEnd = Math.min(lastClosingBrace + 1, lastClosingBracket + 1);
    fixed = fixed.slice(0, validEnd);

    // Ensure it ends with `]`
    if (!fixed.endsWith("]")) fixed += "]";

    return fixed;
  }

  let quizData = sanitizeGeminiOutput(responseText);
  console.log("Sanitized Gemini Response:\n", quizData);

  try {
    return JSON.parse(quizData); // Parse the sanitized JSON
  } catch (err) {
    console.error("Failed to parse Gemini response:", err);
    console.error("Raw Gemini Response:\n", responseText); // Log raw response for debugging
    throw new Error("Gemini returned invalid JSON.");
  }
}

// Generate lesson using Gemini AI
// Define the Type object manually to avoid the 'Type is not defined' error
const generateLesson = async (subject, topic, subTopic, levelOfQuestions) => {
  let category = subject;

  if (topic) category += `, Topic: ${topic}`;
  if (subTopic) category += `, Sub-topic: ${subTopic}`;

  const prompt = `
  Create a uniquely structured lesson on the subject "${subject}".
  ${topic ? `Focus on the topic: "${topic}".` : "generate related topic"}
  ${
    subTopic
      ? `Zoom in on the sub-topic: "${subTopic}".`
      : "generate related subtopic"
  }
  ${
    levelOfQuestions
      ? `Use a question difficulty level of: "${levelOfQuestions}".`
      : ""
  }
  
  Randomize section and subsection headings so they aren't generic.
  Vary the phrasing of objectives and summary.
  Keep tone slightly different each time (e.g., academic, conversational, inspirational).
  
  Return only a **raw JSON** object (no markdown, no triple backticks, no formatting, no explanation).
  
  Output must be structured like this:
  {
    "title": "A fresh and engaging lesson title (varies every time)",
    "subject": "${subject}",
    "topic": "${topic || "N/A"}",
    "introduction": "An original, engaging introduction.",
    "objectives": [
      "Use action verbs and vary phrasing (e.g., 'Explore...', 'Break down...', 'Master the concept of...')"
    ],
    "sections": [
      {
        "heading": "Creative section title (not 'Section 1')",
        "content": "Detailed, clear explanation with a slight twist or teaching hook.",
        "subSections": [
          {
            "heading": "Unique subheading that fits the section theme",
            "content": "Detailed subsection content that builds on the main section."
          },
          {
            "heading": "Another creatively phrased subheading",
            "content": "Another explanatory or example-based subsection."
          }
        ]
      },
      {
        "heading": "Another creative section title",
        "content": "Second section with useful educational content.",
        "subSections": [
          {
            "heading": "Subheading here with a different phrasing style",
            "content": "Complementary or deep-dive content."
          },
          {
            "heading": "Creative or question-based subheading",
            "content": "Example-driven or thought-provoking content."
          }
        ]
      }
    ],
    "conclusion": "Summarize the key learnings in a way that doesn’t repeat the intro."
  }
  `;

  console.log("Sending request for creating lessons to Gemini API...");

  try {
    const result = await model.generateContent({
      model: "gemini-2.0-flash", // Ensure this is the correct model version
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const candidate = result?.response?.candidates?.[0];
    let rawText;



    // Check if candidate and content are valid
    if (candidate?.content?.parts?.[0]?.text) {
      rawText = candidate.content.parts[0].text;
    } else if (typeof candidate?.content === "string") {
      rawText = candidate.content;
    } else if (candidate?.content?.text) {
      rawText = candidate.content.text;
    } else {
      console.error("❌ Unexpected Gemini response format:", candidate);
      throw new Error("Gemini returned an unexpected response format.");
    }

    // Ensure the response is not empty or undefined
    if (!rawText || rawText.trim() === "") {
      console.error("❌ No valid lesson content returned from Gemini API.");
      return; // Exit early if there's no valid content
    }

    // Clean up the raw text
    let lessonText = rawText.replace(/```json|```/g, "").trim();
    lessonText = lessonText.replace(/\n+/g, " ").replace(/\s{2,}/g, " "); // Further clean-up of excessive newlines or spaces

    const parsedLesson =
      typeof lessonText === "string" ? JSON.parse(lessonText) : lessonText;
    return parsedLesson;
  } catch (error) {
    console.error("❌ Error generating lesson:", error);
  }
};

async function generateQuizFromText(text) {
  // Constructing the prompt using the extracted text
  const prompt = `
  You are an educational AI. Generate 5 multiple-choice quiz questions based on the following content:
  \n\n${text}
  
  The quiz should be suitable for an intermediate-level learner.
  Each question should have 4 options with one correct answer, and a brief explanation of the correct answer.

  Return a **valid, compact, one-line JSON array** with the following structure:
  [
    {
      "question": "...",
      "options": ["...", "...", "...", "..."],
      "correctAnswer": "...",
      "explanation": "..."
    },
    ...
  ]
  `;



  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.8,
      top_p: 0.9,
      max_output_tokens: 500,
    },
  });

  // Wait for the response and extract the text
  const responseText = await result.response.text();

  function sanitizeGeminiOutput(output) {
    let fixed = output.replace(/```json|```/g, "").trim();
    fixed = fixed.replace(/(\r\n|\n|\r)/gm, " ");
    fixed = fixed.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
    fixed = fixed.replace(/√/g, "sqrt");
    fixed = fixed.replace(/[½¼¾⅓⅔⅛⅜⅝⅞]/g, "");

    // Safely truncate to the last complete question object
    const lastClosingBrace = fixed.lastIndexOf("}");
    const lastClosingBracket = fixed.lastIndexOf("]");
    const validEnd = Math.min(lastClosingBrace + 1, lastClosingBracket + 1);
    fixed = fixed.slice(0, validEnd);

    // Ensure it ends with `]`
    if (!fixed.endsWith("]")) fixed += "]";

    return fixed;
  }

  let quizData = sanitizeGeminiOutput(responseText);

  try {
    return JSON.parse(quizData); // Parse the sanitized JSON
  } catch (err) {
    throw new Error("Gemini returned invalid JSON.");
  }
}

async function run() {
  try {
    await client.connect();
    const quizzesCollection = client.db("quizGenius").collection("quizzes");
    const database = client.db("quizzGenius");
    const paymentsCollection = database.collection("payments");
    const lessonsCollection = client.db("quizGenius").collection("lessons");

    app.post("/create_payment_invoice", async (req, res) => {

      const { ammount } = req.body;

      // const ammount = parseInt(sammount);

      // create a new paymentIntent

      const options = {
        method: "POST",
        headers: {
          Authorization: "Bearer d1d38461d4c74998b07772dda9cd47ee",
          "Content-Type": "application/json",
        },
        body: `{"amountCurrency":"USD","lifeTime":440,"amount":${ammount},"acceptedCoins":["btc","usdt","usdc"],"underPaidCover":1,"feePaidByPayer":true,"returnUrl":"https://quizz-genius.vercel.app/"}`,
      };

      try {
        const response = await fetch(
          "https://payvra.com/api/v1/merchants/invoice/create",
          options
        );
        const data = await response.json();
        res.send(data);
      } catch (error) {
       
        res.status(500).json({ error: "Failed to create payment invoice" });
      }
    });

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

    app.post("/upload-pdf", upload.single("pdf"), async (req, res) => {
      try {
        const pdfBuffer = req.file.buffer;

        // Parse the PDF buffer
        const data = await pdf(pdfBuffer);
        const text = data.text;

        if (!text) {
          return res.status(400).json({ message: "No text found in PDF" });
        }

        const quizData = await generateQuizFromText(text);

        res.json({ quiz: quizData });
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to process PDF and generate quiz" });
      }
    });

    // Generate Lessons
    app.post("/lessons", async (req, res) => {
      const {
        selectedSubject,
        topics = "",
        subTopics = "",
        levelOfQuestions,
      } = req.body;

      const lessonData = await generateLesson(
        selectedSubject,
        topics,
        subTopics,
        levelOfQuestions
      );

      if (lessonData && Object.keys(lessonData).length > 0) {
        const insertedLesson = await lessonsCollection.insertOne(lessonData);
        res.send(insertedLesson);
      } else {
        res.status(400).send("Invalid lesson data.");
      }
    });

    app.get("/lessons", async (req, res) => {
    
      const page = parseInt(req.query.currentPage);
      const size = parseInt(req.query.itemsPerPage);
      const skip = page * size;
      const count = await lessonsCollection.countDocuments();
      const result = await lessonsCollection
        .find()
        .skip(skip)
        .limit(size)
        .toArray();
      res.send({ result, count });
    });
    app.get("/lesson/:id", async (req, res) => {
      const { id } = req.params;

      const query = { _id: new ObjectId(id) };
      const lesson = await lessonsCollection.findOne(query);
      if (!lesson) {
        return res.status(404).send({ message: "Lesson Not Found" });
      }
      res.send(lesson);
    });

    app.get("/lessons-query", async (req, res) => {
      const { subject, topic, currentPage, itemsPerPage } = req.query;

      const page = parseInt(currentPage);
      const size = parseInt(itemsPerPage);
      const skip = page * size;

      if (!subject) {
        return res.status(400).send({ message: "Missing subject" });
      }

      try {
        const query = { subject: subject };
        if (topic && topic.length() > 0) {
          query.topic = topic;
        }
        let result;
        const count = await lessonsCollection.countDocuments(query);
        if (count > 8) {
          result = await lessonsCollection
            .find(query)
            .skip(skip)
            .limit(size)
            .toArray();
        }
        result = await lessonsCollection
          .find(query).toArray();

    

        res.send({ result, count });
      } catch (error) {
        console.error("Error fetching lessons:", error);
        res.status(500).send({ message: "Error fetching lessons" });
      }
    });

    app.get("/subjects", async (req, res) => {
      try {
        const subjects = await lessonsCollection
          .aggregate([
            {
              $group: {
                _id: "$subject",
                topics: { $push: "$topics" },
              },
            },
            {
              $project: {
                subject: "$_id",
                topics: 1,
                _id: 0,
              },
            },
          ])
          .toArray();
      } catch (error) {
        console.error("Error fetching subjects:", error);
        res.status(500).send({ message: "Error fetching subjects" });
      }
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
