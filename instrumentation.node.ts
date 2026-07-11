import { validateServerConfig } from "@/core/config/env";
import { configureMongoSrvDns } from "@/core/db/connection";

const uri = process.env.MONGODB_URI ?? "";
const dnsServers = (process.env.MONGODB_DNS_SERVERS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

configureMongoSrvDns(uri, dnsServers.length ? dnsServers : null);

validateServerConfig();
