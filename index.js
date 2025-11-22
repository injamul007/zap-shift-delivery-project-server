const express = require("express");
const cors = require("cors");
const app = express();
const { MongoClient, ServerApiVersion } = require("mongodb");
require("dotenv").config();
const port = process.env.PORT || 3000;

//? Middlewares
app.use(cors());
app.use(express.json());

const uri = process.env.URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "zap is shifting",
  });
});

async function run() {
  try {
    await client.connect();

    const db = client.db("zapShift_Db");
    const parcelsCollection = db.collection("parcels");

    //? parcel api for getting all the parcels
    app.get("/parcels", async (req, res) => {
      try {
        const cursor = parcelsCollection.find();
        const result = await cursor.toArray();
        res.json({
          status: "ok",
          result: result,
        });
      } catch (error) {
        res.status(500).json({
          status: "Error",
          message: "Failed to fetch parcels",
        });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log("Successfully connected to MongoDB!");
  } finally {
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`ZapShift Server is Running on PORT: ${port}`);
});
