import { chromium } from 'playwright-core';

async function main() {
  console.log('Connecting to your computer browser...');
  
  // Replace with your personal desktop/laptop computer's local network IP
  const YOUR_COMPUTER_IP = '192.168.1.50'; 
  
  try {
    const browser = await chromium.connectOverCDP(`http://${YOUR_COMPUTER_IP}:9222`);
    // Connect to an existing context or open a fresh one
    const context = browser.contexts()[0] || await browser.newContext();
    const page = await context.newPage();

    console.log('Navigating to site...');
    await page.goto('https://example.com');
    
    const title = await page.textContent('h1');
    console.log(`🎉 Success! Found heading: "${title}"`);
    
    // Disconnect cleanly so your desktop browser stays open
    await browser.close();
  } catch (err) {
    console.error('Connection failed! Make sure Chrome is open with debugging flags on your PC.', err);
  }
}

main();
