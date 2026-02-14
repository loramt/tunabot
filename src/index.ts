import { bot } from "./bot.js";
import { startScheduler } from "./scheduler.js";

console.log("Starting TunaBot...");

bot.start({
  onStart: () => {
    console.log("TunaBot is running!");
    startScheduler(bot);
  },
});

// Graceful shutdown
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`\nReceived ${signal}, shutting down...`);
    bot.stop();
    process.exit(0);
  });
}
