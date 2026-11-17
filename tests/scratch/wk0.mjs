import { webkit } from '../lib/browser.mjs';
import { execSync } from 'child_process';
const browser = await webkit.launch({ headless: true });
const page = await browser.newPage();
await page.goto('data:text/html,hi');
console.log(execSync("ps -axo pid,ppid,lstart,comm | grep -E 'WebKit\\.(WebContent|GPU)\\.Development|Playwright.app' | grep -v grep").toString());
const pid = execSync("pgrep -n -f WebKit.WebContent.Development").toString().trim();
console.log(execSync(`footprint -p ${pid} 2>&1 | head -12`).toString());
await browser.close();
