const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  // Listen to all console messages
  page.on('console', msg => {
    const text = msg.text();
    const type = msg.type();
    if (type === 'error') {
      console.log('BROWSER_ERROR:', text);
    } else {
      console.log('BROWSER_LOG:', text);
    }
  });

  page.on('pageerror', error => {
    console.log('PAGE_ERROR:', error.message);
  });

  page.on('requestfailed', request => {
    console.log('REQUEST_FAILED:', request.url(), request.failure().errorText);
  });

  try {
    console.log('Navigating to http://localhost:5173...');
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
    
    console.log('Waiting for elements to load...');
    await page.waitForTimeout(2000); // give it some time

    console.log('Looking for Cognitive Network (认知网络) button...');
    
    // Evaluate in browser to click the 认知网络 text or button
    await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('*'));
        const target = elements.find(el => el.textContent === '认知网络' && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE');
        if (target) {
            target.click();
        } else {
            console.error('Could not find 认知网络 element');
        }
    });

    console.log('Clicked. Waiting 3 seconds to catch errors...');
    await page.waitForTimeout(3000);
    
  } catch (err) {
    console.error('SCRIPT_ERROR:', err);
  } finally {
    await browser.close();
  }
})();
