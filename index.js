require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const { PayvraClient } = require("payvra-sdk");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.vqld2.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // ------------------db collection---------------------------
    const database = client.db("quizzGenius");
    const paymentsCollection = database.collection("payments");

    app.post("/create_payment_invoice", async (req, res) => {
      console.log("working");
      const { ammount } = req.body;

      // const ammount = parseInt(sammount); 

      // create a new paymentIntent

      const options = {
        method: 'POST',
        headers: {
          Authorization: 'Bearer d1d38461d4c74998b07772dda9cd47ee',
          'Content-Type': 'application/json'
        },
        body: `{"amountCurrency":"USD","lifeTime":440,"amount":${ammount},"acceptedCoins":["btc","usdt","usdc"],"underPaidCover":1,"feePaidByPayer":true,"returnUrl":"https://quizz-genius.vercel.app/"}`
      };

      try {
        const response = await fetch(
          "https://payvra.com/api/v1/merchants/invoice/create",
          options
        );
        const data = await response.json();
        res.send(data);
      } catch (error) {
        console.log(error);
        // Send an error response back to the client
        res.status(500).json({ error: "Failed to create payment invoice" });
      }
    });
  } finally {
    // Ensures that the client will close when you finish/error
    await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
