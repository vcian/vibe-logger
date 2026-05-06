const path = require("path");
const fs = require("fs");
const resolve = require("@rollup/plugin-node-resolve");
const commonjs = require("@rollup/plugin-commonjs");
const typescript = require("@rollup/plugin-typescript");

function copyUiAssetsPlugin() {
  return {
    name: "copy-ui-assets",
    writeBundle() {
      const sourceDir = path.resolve(__dirname, "src/ui");
      const targetDir = path.resolve(__dirname, "dist/ui");
      fs.mkdirSync(targetDir, { recursive: true });

      for (const fileName of fs.readdirSync(sourceDir)) {
        fs.copyFileSync(path.join(sourceDir, fileName), path.join(targetDir, fileName));
      }
    }
  };
}

const plugins = [
  resolve({ preferBuiltins: true }),
  commonjs(),
  typescript({
    tsconfig: "./tsconfig.json",
    declaration: true,
    declarationDir: "dist"
  })
];

module.exports = [
  {
    input: "src/index.ts",
    output: [
      { file: "dist/index.esm.js", format: "esm", sourcemap: true },
      { file: "dist/index.cjs.js", format: "cjs", sourcemap: true, exports: "named" }
    ],
    external: ["express", "fs", "path", "crypto", "readline", "cookie-parser", "bcryptjs", "jsonwebtoken", "express-rate-limit", "dotenv"],
    plugins: [...plugins, copyUiAssetsPlugin()]
  },
  {
    input: "src/auth/hashPassword.ts",
    output: [{ file: "dist/cli.js", format: "cjs", sourcemap: true }],
    external: ["bcryptjs", "readline"],
    plugins
  }
];
