import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
const applications = database.collection("applications");
const payments = database.collection("payments");
const sessions = database.collection("session");

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).send({ message: "Unauthorized" });
    return;
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    res.status(401).send({ message: "Unauthorized" });
    return;
  }

  const query = { token };
  const session = await sessions.findOne(query);
  if (!session) {
    res.status(401).send({ message: "Unauthorized" });
    return;
  }

  const { userId } = session;

  const userQuery = { _id: new ObjectId(userId) };
  const user = await users.findOne(userQuery);
  if (!user) {
    res.status(401).send({ message: "Unauthorized" });
    return;
  }

  req.user = user;
  next();
};

// must call this middleware after verifyToken
const verifySeeker = async (req, res, next) => {
    if (req.user.role !== 'seeker') {
        res.status(403).send({ message: 'Forbidden' });
        return;
    }
    next();
}

const verifyRecruiter = async (req, res, next) => {
    if (req.user.role !== 'recruiter') {
        res.status(403).send({ message: 'Forbidden' });
        return;
    }
    next();
}

const verifyAdmin = async (req, res, next) => {
    if (req.user.role !== 'admin') {
        res.status(403).send({ message: 'Forbidden' });
        return;
    }
    next();
}

// users related apis
app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
    const cursor = users.find({});
    const result = await cursor.toArray();
    res.send(result);
})

app.get("/users/:id/premium", async (req, res) => {
  const { id } = req.params;
  const query = { _id: new ObjectId(id) };
  const result = await users.findOne(query, { projection: { premium: 1 } });
  res.send(result);
});

app.patch("/users/:id/role", verifyToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  const query = { _id: new ObjectId(id) };
  const updatedDoc = {
    $set: {
      role: req.body.role,
    },
  };
  const result = await users.updateOne(query, updatedDoc);
  res.send(result);
});

// jobs related apis
app.get("/jobs", async (req, res) => {
  const query = {};
  // console.log('query', req.query);
  if (req.query) {
    if (req.query.jobType) {
      query.jobType = req.query.jobType;
    }
    if (req.query.isRemote) {
      query.isRemote = req.query.isRemote === "true";
    }
    if (req.query.category) {
      query.category = req.query.category;
    }
    if (req.query.recruiterId) {
      query.recruiterId = req.query.recruiterId;
    }
    if (req.query.search) {
      query.$or = [
        { title: { $regex: req.query.search, $options: "i" } },
        { company: { $regex: req.query.search, $options: "i" } },
        { responsibilities: { $regex: req.query.search, $options: "i" } },
        { requirements: { $regex: req.query.search, $options: "i" } },
      ];
    }
  }

  const cursor = jobs.find(query);
  const result = await cursor.toArray();
  res.send(result);
});

app.get(`/jobs/:id`, async (req, res) => {
  const { id } = req.params;
  const query = { _id: new ObjectId(id) };
  const result = await jobs.findOne(query);
  res.send(result);
});

app.post("/jobs", verifyToken, verifyRecruiter, async (req, res) => {
  const job = req.body;
  const result = await jobs.insertOne(job);
  res.send(result);
});

app.delete("/jobs/:id", async (req, res) => {
  const { id } = req.params;
  const query = { _id: new ObjectId(id) };
  const result = await jobs.deleteOne(query);
  res.send(result);
});

// applications related apis
app.get("/applications", verifyToken, async (req, res) => {
  const query = {};

  if (req.query.applicantId) {
    query.userId = req.query.applicantId;
  }

  if (req.query.jobId) {
    const jobQuery = { _id: new ObjectId(req.query.jobId) };
    const job = await jobs.findOne(jobQuery);
    if (
      job.recruiterId !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      res.status(403).send({ message: "Forbidden" });
      return;
    }
    query.jobId = req.query.jobId;
  }

  const cursor = applications.find(query);
  const result = await cursor.toArray();
  res.send(result);
});

app.get("/applications/count", async (req, res) => {
  const query = {};
  if (req.query.applicantId) {
    query.userId = req.query.applicantId;
  }
  const result = await applications.countDocuments(query);
  res.send({ count: result });
});

app.post("/applications", verifyToken, verifySeeker, async (req, res) => {
  const application = req.body;
  const result = await applications.insertOne(application);
  res.send(result);
});

app.patch("/applications/:id", async (req, res) => {
  const { id } = req.params;
  const query = { _id: new ObjectId(id) };
  const updatedDoc = {
    $set: {
      status: req.body.status,
    },
  };
  const result = await applications.updateOne(query, updatedDoc);
  res.send(result);
});

app.post("/payments/checkout-verify", async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res
        .status(400)
        .send({ success: false, message: "Session ID is required" });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const { status, payment_status, customer_email, metadata, payment_intent } = session;

    if (status === "complete" && payment_status === "paid") {
      const sessionQuery = { sessionId };
      const existingPayment = await payments.findOne(sessionQuery);
      if (existingPayment) {
        return res.send({
          success: true,
          message: "Payment already verified",
          payment: existingPayment,
        });
      }

      const payment = {
        sessionId,
        status,
        payment_status,
        customer_email,
        userId: metadata?.userId,
        payment_date: new Date(),
        payment_intent,
      };

      const result = await payments.insertOne(payment);

      let updateResult = null;
      if (metadata?.userId && ObjectId.isValid(metadata.userId)) {
        const query = { _id: new ObjectId(metadata.userId) };
        const updatedDoc = {
          $set: {
            premium: true,
          },
        };
        updateResult = await users.updateOne(query, updatedDoc);
      }

      return res.send({ success: true, result, updateResult });
    }

    return res
      .status(400)
      .send({ success: false, message: "Payment verification failed" });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});


export default app;