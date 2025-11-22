const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

//? Middlewares
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "zap is shifting",
  });
});

app.listen(port, () => {
  console.log(`ZapShift Server is Running on PORT: ${port}`)
})