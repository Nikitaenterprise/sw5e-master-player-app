// A server in its own process, for tests that need to kill it for real (F-009).
// Arguments: events folder, characters folder. Prints "PORT <n>" once it listens.
// Git and state point at the events folder, so nothing can reach the owner's repository.
import { start } from '../../apps/server/src/index.js';

const [eventsDir, charactersDir] = process.argv.slice(2);
if (eventsDir === undefined || charactersDir === undefined) {
  throw new Error('usage: serve-for-test.ts <eventsDir> <charactersDir>');
}
const server = await start(0, {
  eventsDir,
  charactersDir,
  repoDir: eventsDir,
  stateDir: eventsDir,
  sessionNumber: 1,
});
console.log(`PORT ${server.port}`);
