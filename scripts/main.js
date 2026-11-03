// Nookworks for Bedrock: entry point. Every feature registers itself on import.
import "./lib/blocks.js";
import "./features/index.js";
import { DEV } from "./generated/dev.js";

if (DEV) import("./test/runner.js");
