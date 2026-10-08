import { cp, mkdir } from "node:fs/promises";

const destination = new URL("../dist/queue/lua/", import.meta.url);
await mkdir(destination, { recursive: true });
await cp(new URL("../src/queue/lua/hourlyLimit.lua", import.meta.url), new URL("hourlyLimit.lua", destination));
