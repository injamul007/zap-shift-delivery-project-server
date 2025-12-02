require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 3000;
const stripe = require("stripe")(`${process.env.STRIPE_SECRET}`);

const admin = require("firebase-admin");

const serviceAccount = require("./zapshift-firebase-adminsdk-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

function generateTrackingId() {
  const prefix = "PRCL"; // brand prefix
  const time = Date.now().toString(36); // compact timestamp
  const rand = Math.random().toString(36).slice(2, 8); // 6-chars random
  return `${prefix}-${time}-${rand.toUpperCase()}`;
}

//? Middlewares
app.use(cors());
app.use(express.json());

const verifyFBToken = async(req, res, next) => {
  const token = req.headers?.authorization;

  //?validate if token has or not
  if (!token) {
    return res.status(401).json({
      status: false,
      message: "Unauthorized access",
    });
  }

try {
  const idToken = token.split(" ")[1]
  const decode = await admin.auth().verifyIdToken(idToken)
  console.log('decoded in the token-->',decode)
  req.decoded_email = decode.email;

  next();
} catch (error) {
  return res.status(401).json({
    status: false,
    message: "Unauthorized access"
  })
}
};

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
    const paymentInfoCollection = db.collection("paymentInfo");

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

        //? validate payment cost
        if (
          !paymentInfo ||
          !paymentInfo.cost ||
          isNaN(paymentInfo.cost) ||
          paymentInfo.cost <= 0
        ) {
          return res.status(400).json({
            status: false,
            message: "Invalid Payment cost type",
          });
        }

        const amount = Math.round(Number(paymentInfo.cost) * 100);
        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: amount,
                product_data: {
                  name: `Please pay for: ${paymentInfo?.parcelName}`,
                },
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          customer_email: paymentInfo?.senderEmail || undefined,
          metadata: {
            parcelId: paymentInfo?.parcelId || "",
            parcelName: paymentInfo?.parcelName || undefined,
          },
          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });
        console.log(session);
        res.status(201).json({
          status: true,
          message: "Payment checkout session created Successful",
          url: session.url,
        });
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to create payment checkout session api",
          error: error.message,
        });
      }
    });

    //? patch payment data
    app.patch("/payment-success", async (req, res) => {
      try {
        const sessionId = req.query.session_id;

        const session = await stripe.checkout.sessions.retrieve(sessionId);
        console.log(session);

        const trackingId = generateTrackingId();

        const transactionId = session?.payment_intent;
        const query = { transactionId: transactionId };

        const paymentExits = await paymentInfoCollection.findOne(query);

        //? validate payment is exits or not
        if (paymentExits) {
          return res.status(409).json({
            status: false,
            message: "transaction id already exits",
            transactionId,
            trackingId: paymentExits.trackingId,
          });
        }

        if (session.payment_status === "paid") {
          const id = session?.metadata?.parcelId;
          const query = { _id: new ObjectId(id) };
          const update = {
            $set: {
              paymentStatus: "paid",
              trackingId: trackingId,
            },
          };
          const result = await parcelsCollection.updateOne(query, update);

          const paymentInfo = {
            parcelId: session.metadata.parcelId,
            parcelName: session.metadata.parcelName,
            amount: session.amount_total / 100,
            currency: session.currency,
            customer_email: session.customer_email,
            transactionId: session?.payment_intent,
            paymentStatus: session.payment_status,
            paid_At: new Date(),
            trackingId: trackingId,
          };

          const resultPayment = await paymentInfoCollection.insertOne(
            paymentInfo
          );

          res.status(200).json({
            status: true,
            message: "Payment Patch and create successful",
            modifiedParcel: result,
            trackingId: trackingId,
            transactionId: session?.payment_intent,
            paymentInfo: resultPayment,
          });
        }
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to Patch payment",
          error: error.message,
        });
      }
    });

    //? payment history related apis
    app.get("/payment-history", verifyFBToken, async (req, res) => {
      try {
        const email = req.query.email;
        // //? Email validation
        // if (!email) {
        //   return res.status(400).json({
        //     status: false,
        //     message: "Email is Required",
        //   });
        // }

        // const query = { customer_email: email };

        const query = {}
        if(email) {
          query.customer_email = email;

          if(email !== req.decoded_email) {
            return res.status(403).json({
              status: false,
              message: "Forbidden Access"
            })
          }
        }
        const result = await paymentInfoCollection
          .find(query)
          .sort({ paid_At: -1 })
          .toArray();

        //? validate result is exits or not
        if (result.length === 0) {
          return res.status(404).json({
            status: false,
            message: "Payment history not found",
          });
        }
        res.status(200).json({
          status: true,
          message: "Get payment history by email successful",
          result,
        });
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to get payment history by email",
          error: error.message,
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
