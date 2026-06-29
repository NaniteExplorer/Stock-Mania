import dns from "node:dns";
import { validateServerConfig } from "@/core/config/env";

const dnsServers = process.env.MONGODB_DNS_SERVERS;
const uri = process.env.MONGODB_URI ?? "";

if (dnsServers && uri.startsWith("mongodb+srv://")) {
  const servers = dnsServers
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (servers.length > 0) {
    dns.setServers(servers);
  }
}

validateServerConfig();
