const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('./models/User');

const MONGO_URI = "mongodb://admin:relcon2024@relcon_mongo:27017/relconDB?authSource=admin";

async function seed() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB for seeding");

    const salt = await bcrypt.genSalt(10);
    const hashedPwd = await bcrypt.hash("password123", salt);

    const users = [
      { username: "nikhil.trivedi", password: hashedPwd, role: "admin", engineerName: "Nikhil Trivedi", empId: "EMP001" },
      { username: "test.user", password: hashedPwd, role: "user", engineerName: "Test User", empId: "EMP002" },
      { username: "admin", password: hashedPwd, role: "admin", engineerName: "Administrator", empId: "EMP000" }
    ];

    for (const u of users) {
      await User.updateOne({ username: u.username }, { $set: u }, { upsert: true });
      console.log(`User ${u.username} seeded`);
    }

    mongoose.disconnect();
    console.log("Seeding complete");
  } catch (err) {
    console.error("Seeding error:", err);
  }
}

seed();
