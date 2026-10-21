import { hash } from "@node-rs/argon2";

const password = process.argv[2];
if (!password || password.length < 8) {
  console.error("Informe uma senha com pelo menos 8 caracteres.");
  process.exit(1);
}
const hashed = await hash(password);
console.log(hashed);
