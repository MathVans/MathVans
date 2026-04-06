import path from 'path'
import fs from 'fs-extra'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageJSON = fs.readJSONSync(path.resolve(__dirname, '..', 'package.json'))

export const CONFIG = {
  ...packageJSON.config,
  GITHUB_UID: process.env.GITHUB_UID || packageJSON.config.GITHUB_UID,
  NPM_UID: process.env.NPM_UID || packageJSON.config.NPM_UID
}
export const OUTPUT_DIR = path.join(__dirname, '..', 'output')

export const GITHUB_ACCESS_TOKEN = process.env.GITHUB_ACCESS_TOKEN || process.env.GITHUB_TOKEN || ''
