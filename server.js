import express from 'express';
import cors from 'cors';
import inventoryRoutes from './routes/inventory.js';
import userRoutes from './routes/users.js';
import soldRoutes from './routes/sold.js';
import { errorHandler, notFound } from './middleware/error.js';
import dotenv from 'dotenv';
import connectDB from "./database.js";

// dotenv.config();

// console.log("🧪 ENV CHECK:", {
//   DB_TYPE: process.env.DB_TYPE,
//   MONGO_URI: process.env.MONGO_URI,
// });

const app = express();
app.use(cors());
app.use(express.json());

connectDB();

app.use('/api/inventory', inventoryRoutes);
app.use('/api/users', userRoutes);
app.use('/api/sold', soldRoutes);

app.get("/", (req, res) => {
  res.json({ message: "Backend is running 🚀" });
});


app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
