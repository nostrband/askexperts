import { SimplePool } from 'nostr-tools';
import { Nostr } from '../src/experts/utils/Nostr.js';

/**
 * Test for the Nostr utility class
 * Fetches profile and posts for a specific pubkey and prints the results
 */
async function testNostrCrawlProfile() {
  console.log('Starting Nostr crawlProfile test...');
  
  // Create a SimplePool instance
  const pool = new SimplePool();
  
  try {
    // Create a Nostr instance
    const nostr = new Nostr(pool);
    
    // The pubkey to test with
    const pubkey = '3356de61b39647931ce8b2140b2bab837e0810c0ef515bbe92de0248040b8bdd';
    
    console.log(`Fetching profile and posts for pubkey: ${pubkey}`);
    
    // Call the crawlProfile method with a smaller limit for testing
    const profileInfo = await nostr.crawlProfile(pubkey, 10);
    
    // Print the profile information
    console.log('\nProfile Information:');
    console.log(JSON.stringify(profileInfo.profile, null, 2));
    
    // Print the number of posts fetched
    console.log(`\nFetched ${profileInfo.posts.length} posts`);
    
    // Print a sample of the posts
    console.log('\nPosts:');
    const samplePosts = profileInfo.posts.slice(0, 3);
    samplePosts.forEach((post, index) => {
      console.log(`\nPost ${index + 1}:`);
      console.log(post.content.substring(0, 200) + (post.content.length > 200 ? '...' : ''));
      
      // Print reply context if available
      if (post.in_reply_to) {
        console.log(`\nIn reply to:`);
        console.log(`Author: ${post.in_reply_to.pubkey}`);
        console.log(`Content: ${post.in_reply_to.content.substring(0, 100)}${post.in_reply_to.content.length > 100 ? '...' : ''}`);
      }
    });
    
    console.log('\nTest completed successfully!');
  } catch (error) {
    console.error('Error during test:', error);
  } finally {
    // Close the pool to clean up resources
    pool.destroy(); // Use destroy() instead of close() to clean up all resources
  }
}

// Run the test
testNostrCrawlProfile().catch(error => {
  console.error('Unhandled error in test:', error);
  process.exit(1);
});