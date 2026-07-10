import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { dash, sentinel } from "@better-auth/infra";
import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.DATABASE_URL!);
const db = client.db();

export const auth = betterAuth({
  database: mongodbAdapter(db),
  baseURL: "http://localhost:3000/",
  emailAndPassword: { enabled: true },
  plugins: [sentinel(), dash()],
});
