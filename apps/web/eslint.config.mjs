import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname
});

/** ESLint 9 flat config: 직접 eslint-config-next 서브패스 import는 Vercel 등에서 경로 깨짐 방지 */
export default [...compat.extends("next/core-web-vitals")];
