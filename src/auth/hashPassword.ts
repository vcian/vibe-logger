import bcrypt from "bcryptjs";
import readline from "readline";

async function promptPassword(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const value: string = await new Promise<string>((resolve: (value: string) => void): void => {
    rl.question("Enter password: ", (answer: string): void => {
      resolve(answer);
    });
  });
  rl.close();
  return value;
}

export async function runHashPasswordCli(): Promise<void> {
  const provided: string | undefined = process.argv[2];
  const password: string = provided && provided.trim().length > 0 ? provided : await promptPassword();
  if (!password) {
    throw new Error("Password cannot be empty.");
  }
  const hash: string = await bcrypt.hash(password, 10);
  // eslint-disable-next-line no-console
  console.log(hash);
}

if (require.main === module) {
  runHashPasswordCli().catch((error: unknown): void => {
    const message: string = error instanceof Error ? error.message : "Failed to hash password";
    // eslint-disable-next-line no-console
    console.error(message);
    process.exitCode = 1;
  });
}
