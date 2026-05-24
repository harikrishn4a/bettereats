#!/usr/bin/env node

import puppeteer from 'puppeteer-core';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { execSync } from 'child_process';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const DISTRICTS = [
  { name: 'Ang Mo Kio', postal: '569627' },
  { name: 'Bedok', postal: '469541' },
  { name: 'Bishan', postal: '571818' },
  { name: 'Bukit Batok', postal: '659678' },
  { name: 'Bukit Merah', postal: '159200' },
  { name: 'Bukit Timah', postal: '269655' },
  { name: 'Choa Chu Kang', postal: '689124' },
  { name: 'Clementi', postal: '120123' },
  { name: 'Geylang', postal: '389700' },
  { name: 'Hougang', postal: '530123' },
  { name: 'Jurong East', postal: '609718' },
  { name: 'Jurong West', postal: '649045' },
  { name: 'Kallang', postal: '397689' },
  { name: 'Katong', postal: '440110' },
  { name: 'Macpherson', postal: '368251' },
  { name: 'Marine Parade', postal: '449770' },
  { name: 'Novena', postal: '308167' },
  { name: 'Orchard', postal: '238884' },
  { name: 'Potong Pasir', postal: '347890' },
  { name: 'Punggol', postal: '828808' },
  { name: 'Queenstown', postal: '149876' },
  { name: 'Serangoon', postal: '555089' },
  { name: 'Sengkang', postal: '544750' },
  { name: 'Senoko', postal: '758098' },
  { name: 'Sentosa', postal: '099803' },
  { name: 'Sembawang', postal: '769464' },
  { name: 'Tampines', postal: '529203' },
  { name: 'Tanjong Pagar', postal: '018956' }
];

let supabase;

async function initSupabase() {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('✅ Supabase connected\n');
}

async function extractRestaurantsFromPage(page) {
  // Don't scroll here - already done in scrapeDistrict
  
  // Extract restaurant data using the smart parser
  const restaurants = await page.evaluate(() => {
    function smartParseRestaurant(fullText) {
      if (!fullText) return null;
      
      let text = fullText.replace(/^Promo/, '').trim();
      const ratingBeforeMins = text.match(/([0-4]\.[0-9]|5\.0)(?=\d*\s*mins)/);
      const rating = ratingBeforeMins ? parseFloat(ratingBeforeMins[1]) : 0;
      let textWithoutRating = text.replace(/[0-4]\.[0-9]|5\.0/, '');
      const timeMatch = textWithoutRating.match(/\b([1-9][0-9])\s*mins?\b/);
      const deliveryMins = timeMatch ? parseInt(timeMatch[1]) : 0;
      
      const locationEndings = ['Street', 'Plaza', 'Centre', 'Center', 'Mall', 'Court', 'Drive', 'Road', 'Avenue', 'Estate', 'Tower', 'Building', 'Block', 'Park', 'Garden', 'Arcade', 'Kampong', 'Jalan', 'Lorong', 'Lebuh'];
      
      let nameEnd = text.length;
      for (const location of locationEndings) {
        const pattern = new RegExp(`${location}([A-Z])`, 'g');
        const match = pattern.exec(text);
        if (match) {
          nameEnd = Math.min(nameEnd, match.index + location.length);
          break;
        }
      }
      
      if (nameEnd === text.length) {
        const boundaryMatch = text.match(/[a-z]([A-Z][a-z]+[,\s])/);
        if (boundaryMatch) {
          nameEnd = text.indexOf(boundaryMatch[1], boundaryMatch.index);
        }
      }
      
      const name = text.substring(0, nameEnd).trim();
      let cuisine = text.substring(nameEnd).replace(/[0-4]\.[0-9]|5\.0/, '').replace(/\d+\s*mins.*/, '').replace(/\$\s*OFF.*/, '').replace(/•.*/, '').trim().substring(0, 150);
      
      return {
        name: name.substring(0, 150),
        cuisine: cuisine,
        rating: Math.min(Math.max(rating, 0), 5),
        delivery_time: deliveryMins > 0 ? `${deliveryMins} mins` : '',
      };
    }
    
    const rawRestaurants = [];
    const links = document.querySelectorAll('a[href*="/restaurant/"]');
    links.forEach(link => {
      let container = link;
      for (let i = 0; i < 10; i++) {
        container = container.parentElement;
        const text = container?.textContent;
        if (text && text.length > 20 && text.length < 500) {
          const name = link.textContent?.split('\n')[0]?.trim();
          if (name) {
            rawRestaurants.push({ name, text: text.substring(0, 300), url: link.href });
            break;
          }
        }
      }
    });
    
    const parsed = rawRestaurants.map(r => {
      const p = smartParseRestaurant(r.text);
      return { ...p, url: r.url };
    });
    
    // Deduplicate by URL
    const seen = new Set();
    const unique = [];
    parsed.forEach(item => {
      if (item && item.url && !seen.has(item.url)) {
        unique.push(item);
        seen.add(item.url);
      }
    });
    
    return unique;
  });
  
  return restaurants;
}

async function scrapeDistrict(page, district, index, total) {
  console.log(`\n[${index}/${total}] ${district.name}`);
  
  try {
    const url = `https://food.grab.com/sg/en/restaurants`;
    console.log(`  ⏳ Loading Grab...`);
    
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    
    // Wait for page to render
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Don't try to find the input - just use keyboard to interact
    // Tab to the location input and type
    console.log(`  ✍️  Using keyboard to change location for ${district.name}...`);
    try {
      // Press Tab to move focus (location input should be near top)
      await page.keyboard.press('Tab');
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Type the postal code
      await page.keyboard.type(district.postal, { delay: 30 });
      await new Promise(resolve => setTimeout(resolve, 1500)); // Wait for dropdown
      
      // Press Arrow Down to select first suggestion
      await page.keyboard.press('ArrowDown');
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Press Enter to confirm
      await page.keyboard.press('Enter');
      console.log(`  ✅ Location change triggered, waiting for restaurants to load...`);
      
      // Wait for page to update
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // DEBUG: Confirm location changed by checking page text
      const locationConfirm = await page.evaluate(() => {
        // Look for location text on page
        const pageText = document.body.innerText;
        const lines = pageText.split('\n');
        const locationLine = lines.find(line => line.includes('Restaurants in') || line.includes('Deliver to'));
        return locationLine || 'Location text not found';
      });
      console.log(`  📍 Location confirmation: ${locationConfirm}`);
      
    } catch (e) {
      console.log(`  ⚠️  Error changing location: ${e.message}`);
    }
    
    // Scroll to load restaurants
    console.log(`  📍 Scrolling to load restaurants...`);
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Extract restaurants
    const restaurants = await extractRestaurantsFromPage(page);
    console.log(`  🍽️  Found ${restaurants.length} restaurants`);
    
    // DEBUG: Print first 5 restaurant names
    if (restaurants.length > 0) {
      const first5 = restaurants.slice(0, 5).map(r => r.name).join(', ');
      console.log(`  📋 First 5 restaurants: ${first5}`);
    }
    
    // Save to Supabase
    if (restaurants.length > 0) {
      // Deduplicate by name + district to avoid duplicates
      const uniqueRestaurants = [];
      const seen = new Set();
      
      restaurants.forEach(r => {
        const key = `${r.name}|${district.name}`;
        if (!seen.has(key)) {
          uniqueRestaurants.push({
            name: r.name,
            cuisine: r.cuisine || '',
            rating: r.rating || 0,
            grab_url: r.url,
            district: district.name,
            delivery_time: r.delivery_time || '',
            health_score: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
          seen.add(key);
        }
      });
      
      if (uniqueRestaurants.length > 0) {
        const { error } = await supabase
          .from('restaurants')
          .insert(uniqueRestaurants);
        
        if (error && !error.message.includes('duplicate')) {
          console.log(`  ❌ Save error: ${error.message}`);
        } else {
          console.log(`  💾 Saved ${uniqueRestaurants.length} restaurants`);
        }
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (error) {
    console.log(`  ❌ Error: ${error.message}`);
  }
}

async function connectToExistingBrowser() {
  console.log('🔌 Connecting to Chrome with debugging port...\n');
  
  try {
    // First, get the correct WebSocket endpoint from Chrome
    const response = await fetch('http://127.0.0.1:9222/json/version');
    const data = await response.json();
    const wsEndpoint = data.webSocketDebuggerUrl;
    
    console.log(`Found endpoint: ${wsEndpoint}`);
    
    const browser = await puppeteer.connect({
      browserWSEndpoint: wsEndpoint
    });
    
    console.log('✅ Connected to existing Chrome instance!\n');
    return browser;
  } catch (error) {
    console.error('❌ Could not connect to Chrome');
    console.error('\nPlease follow these steps:');
    console.error('1. Run: /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222 --incognito --user-data-dir=/tmp/chrome-debug https://food.grab.com/sg/en/restaurants &');
    console.error('2. Log into Grab in that Chrome window');
    console.error('3. Run this script again');
    console.error('\nError details:', error.message);
    process.exit(1);
  }
}

async function main() {
  console.log('🚀 Extracting Restaurants Using Your Logged-In Browser\n');
  
  await initSupabase();
  
  const browser = await connectToExistingBrowser();
  
  // Get the first page/tab
  const pages = await browser.pages();
  const page = pages[0];
  
  console.log(`Using browser tab: ${await page.title()}\n`);
  
  for (let i = 0; i < DISTRICTS.length; i++) {
    await scrapeDistrict(page, DISTRICTS[i], i + 1, DISTRICTS.length);
  }
  
  await browser.disconnect();
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ Complete!`);
  console.log(`${'='.repeat(60)}`);
  console.log(`\n✨ All districts extracted!\n`);
}

main().catch(console.error);