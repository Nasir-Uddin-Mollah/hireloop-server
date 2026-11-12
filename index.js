import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());
app.use(cors());

// database
const client = new MongoClient(process.env.MONGODB_URL);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectedClient = await connectToMongoDB();
const database = connectedClient.db("hireloopdb");
const users = database.collection("user");
const jobs = database.collection("jobs");

app.get("/users", async (req, res) => {
  const cursor = await users.find({}).toArray();
  res.send(cursor);
});

// jobs related apis
app.get("/jobs", async (req, res) => {
  const cursor = jobs.find();
  const result = await cursor.toArray();
  res.send(result);
});

app.post("/jobs", async (req, res) => {
  const job = req.body;
  const result = await jobs.insertOne(job);
  res.send(result);
});

app.delete("/jobs/:id", async (req, res) => {
  const {id} = req.params;
  const query = { _id: new ObjectId(id) };
  const result = await jobs.deleteOne(query);
  res.send(result);
});


app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
