// Standalone MongoDB connectivity probe. Run: node scripts/db-check.mjs
import "dotenv/config";
import dns from "node:dns";
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.log("MONGODB_URI not set");
  process.exit(2);
}

const servers = (process.env.MONGODB_DNS_SERVERS || "1.1.1.1,8.8.8.8")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (uri.startsWith("mongodb+srv://")) {
  dns.setServers(servers);
  console.log("DNS servers in use:", dns.getServers().join(", "));
}

try {
  await mongoose.connect(uri, {
    bufferCommands: false,
    serverSelectionTimeoutMS: 10000,
  });
  console.log("RESULT: MONGO_OK — connected to Atlas");
  await mongoose.disconnect();
  process.exit(0);
} catch (e) {
  console.log("RESULT: MONGO_FAIL:", e?.message || e);
  process.exit(1);
}
