require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 3000;
const stripe = require("stripe")(`${process.env.STRIPE_SECRET}`);

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
        const email = req.query.email;
        const query = {};
        if (email) {
          query.senderEmail = email;
        }
        const options = { sort: { createdAt: -1 } };
        const cursor = parcelsCollection.find(query, options);
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

    //? get api for getting single parcel data from database
    app.get("/parcels/:id", async (req, res) => {
      try {
        const parcelId = req.params.id;

        //? Validate Object id
        if (!ObjectId.isValid(parcelId)) {
          return res.status(400).json({
            status: "error",
            message: "Invalid Object Id format",
          });
        }

        const query = { _id: new ObjectId(parcelId) };
        const result = await parcelsCollection.findOne(query);

        //? Validate result if not found
        if (!result) {
          return res.status(404).json({
            status: "error",
            message: "Parcel not found",
          });
        }

        res.status(200).json({
          status: "ok",
          message: "Fetch Single Parcel Data successfully",
          result: result,
        });
      } catch (error) {
        res.status(500).json({
          status: "error",
          message: "Failed to fetch single parcel data",
        });
      }
    });

    //? post api for creating parcels post in the database
    app.post("/parcels", async (req, res) => {
      try {
        const newParcel = req.body;
        //? parcel created time
        newParcel.createdAt = new Date();
        const result = await parcelsCollection.insertOne(newParcel);
        res.status(201).json({
          status: "ok",
          message: "parcel created successfully",
          result: result,
        });
      } catch (error) {
        res.status(500).json({
          status: "Error",
          message: "Failed to post parcels",
        });
      }
    });

    //? Delete api for delete the parcel from database
    app.delete("/parcels/:id", async (req, res) => {
      try {
        const parcelId = req.params.id;
        const query = { _id: new ObjectId(parcelId) };
        const result = await parcelsCollection.deleteOne(query);
        res.status(200).json({
          status: "ok",
          message: "Delete parcel from api is successful",
          result: result,
        });
      } catch (error) {
        res.status(500).json({
          status: "error",
          message: "Failed to Delete from API",
        });
      }
    });

    //? Payment Related APIs
    app.post("/payment-checkout-session", async (req, res) => {
      try {
        const paymentInfo = req.body;

        //? Validate payment cost if not found in correct value
        if (!paymentInfo || !paymentInfo.cost || isNaN(paymentInfo.cost)) {
          return res.status(400).json({
            status: "error",
            message: "Invalid Cost type",
          });
        }

        const amount = Math.round(Number(paymentInfo.cost) * 100);
        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "USD",
                unit_amount: amount,
                product_data: {
                  name: `Please Pay for ${paymentInfo.parcelName}`,
                },
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          metadata: {
            parcelId: paymentInfo.parcelId,
          },
          customer_email: paymentInfo.senderEmail,
          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });

        console.log(session);
        res.status(200).json({
          status: "ok",
          message: "Payment post api created successfully",
          url: session.url,
        });
      } catch (error) {
        res.status(500).json({
          status: "error",
          message: "Failed to create payment session data",
        });
      }
    });

    //? payment api PATCH for getting session id
    app.patch("/payment-success", async (req, res) => {
      try {
        const sessionId = req.query.session_id;

        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if(session.payment_status === "paid") {
          const query = {_id: new ObjectId(session.metadata.parcelId)}
          const update = {
            $set: {
              paymentStatus: "paid"
            }
          }
          const result = await parcelsCollection.updateOne(query, update)

          res.status(200).json({
          status: "ok",
          message: "Payment Session id getting success",
          result: result
        });
        }
      } catch (error) {
        res.status(500).json({
          status: "ok",
          message: "Failed to retrieve session id"
        })
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
