#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function generateSlug(restaurantName) {
  return restaurantName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function generateGrabUrl(restaurantName, merchantId) {
  const slug = generateSlug(restaurantName);
  return `https://food.grab.com/sg/en/restaurant/${slug}/${merchantId}`;
}

function extractMerchantId(currentUrl) {
  const match = currentUrl.match(/\/([^\/]+)$/);
  if (match && match[1]) {
    return match[1];
  }
  const parts = currentUrl.split('/');
  const lastPart = parts[parts.length - 1];
  if (lastPart && (lastPart.startsWith('4-') || lastPart.startsWith('SGDD'))) {
    return lastPart;
  }
  return null;
}

async function regenerateUrls() {
  console.log('🔄 Regenerating Grab URLs for ALL restaurants...\n');
  
  // Get total count first
  const { count } = await supabase
    .from('restaurants')
    .select('*', { count: 'exact', head: true });
  
  console.log(`📍 Total restaurants in database: ${count}\n`);
  
  let updated = 0;
  let processed = 0;
  let batchSize = 1000;
  
  // Fetch in batches
  for (let offset = 0; offset < count; offset += batchSize) {
    console.log(`📥 Fetching batch ${Math.floor(offset / batchSize) + 1}...`);
    
    const { data: restaurants, error } = await supabase
      .from('restaurants')
      .select('id, name, grab_url')
      .range(offset, offset + batchSize - 1);
    
    if (error) {
      console.error('❌ Error fetching batch:', error.message);
      continue;
    }
    
    console.log(`   Processing ${restaurants.length} restaurants...`);
    
    for (const restaurant of restaurants) {
      const merchantId = extractMerchantId(restaurant.grab_url);
      if (!merchantId) {
        processed++;
        continue;
      }
      
      const newUrl = generateGrabUrl(restaurant.name, merchantId);
      
      if (newUrl !== restaurant.grab_url) {
        const { error: updateError } = await supabase
          .from('restaurants')
          .update({ grab_url: newUrl })
          .eq('id', restaurant.id);
        
        if (!updateError) {
          updated++;
        }
      }
      
      processed++;
    }
    
    console.log(`   ✅ Processed ${processed}/${count}...\n`);
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ Complete!`);
  console.log(`${'='.repeat(60)}`);
  console.log(`✅ Updated: ${updated}`);
  console.log(`📊 Processed: ${processed}/${count}`);
  console.log(`${'='.repeat(60)}\n`);
}

regenerateUrls().catch(console.error);