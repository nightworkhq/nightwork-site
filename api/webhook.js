/**
 * Nightwork Stripe Webhook Handler
 *
 * Receives payment events from Stripe and triggers order fulfillment:
 * - For spreadsheet templates: sends download link via email
 * - For collage orders: sends confirmation + instructions to submit photos
 *
 * Deploy: Vercel serverless function at /api/webhook
 */

const NIGHTWORK_EMAIL = 'nightworkstudio@proton.me';

// Product type mapping (Stripe product ID -> fulfillment type)
// These will be populated once we create the actual Stripe products
const PRODUCT_TYPES = {
  // Templates - instant delivery
  'wedding_budget': { type: 'template', file: 'wedding_budget_tracker.xlsx', name: 'Wedding Budget Tracker' },
  'freelancer_finance': { type: 'template', file: 'freelancer_finance_dashboard.xlsx', name: 'Freelancer Finance Dashboard' },
  'cash_flow': { type: 'template', file: 'cash_flow_forecast.xlsx', name: 'Cash Flow Forecast' },
  'social_media': { type: 'template', file: 'social_media_calendar.xlsx', name: 'Social Media Content Calendar' },
  'habit_tracker': { type: 'template', file: 'habit_tracker.xlsx', name: 'Monthly Habit Tracker' },
  'property_investment': { type: 'template', file: 'property_investment_analyser.xlsx', name: 'Property Investment Analyser' },
  'side_hustle': { type: 'template', file: 'side_hustle_income_tracker.xlsx', name: 'Side Hustle Income Tracker' },
  'meal_planner': { type: 'template', file: 'meal_planner_grocery.xlsx', name: 'Meal Planner & Grocery List' },

  // Collages - custom fulfillment (need photos from customer)
  'collage_scattered': { type: 'collage', style: 'scattered', name: 'Scattered Polaroid Collage' },
  'collage_heart': { type: 'collage', style: 'heart', name: 'Heart Photo Collage' },
  'collage_grid': { type: 'collage', style: 'grid', name: 'Grid Layout Collage' },
  'collage_filmstrip': { type: 'collage', style: 'filmstrip', name: 'Vintage Film Strip Collage' },
  'collage_hero': { type: 'collage', style: 'hero', name: 'Hero Gallery Collage' },
  'collage_bundle': { type: 'collage', style: 'bundle', name: '5-Style Bundle' },
  'collage_mum': { type: 'collage', style: 'scattered', name: 'Reasons We Love Mum Collage' },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const event = req.body;

    // Handle checkout.session.completed
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const customerEmail = session.customer_details?.email;
      const paymentStatus = session.payment_status;

      if (paymentStatus !== 'paid') {
        console.log(`Payment not completed: ${paymentStatus}`);
        return res.status(200).json({ received: true });
      }

      // Log the order
      console.log(`[ORDER] ${new Date().toISOString()} | ${customerEmail} | ${session.amount_total / 100} ${session.currency}`);

      // Determine product type from metadata
      const productKey = session.metadata?.product_key;
      const product = PRODUCT_TYPES[productKey];

      if (!product) {
        console.log(`[WARN] Unknown product key: ${productKey}`);
        // Still acknowledge - don't fail the webhook
        return res.status(200).json({ received: true, warning: 'unknown product' });
      }

      if (product.type === 'template') {
        // Instant delivery - send download link
        // TODO: Generate signed download URL and email it
        console.log(`[FULFILL] Template order: ${product.name} -> ${customerEmail}`);

        // For now, log for manual fulfillment via Sentinel alert
        // Once SMTP is set up, this sends automatically
      }

      if (product.type === 'collage') {
        // Custom order - send instructions to submit photos
        console.log(`[FULFILL] Collage order: ${product.name} (${product.style}) -> ${customerEmail}`);

        // For now, log for manual fulfillment
        // Customer needs to email photos to nightworkstudio@proton.me
      }

      return res.status(200).json({ received: true, fulfilled: product.type });
    }

    // Handle other event types
    return res.status(200).json({ received: true });

  } catch (err) {
    console.error(`[ERROR] Webhook failed: ${err.message}`);
    return res.status(400).json({ error: err.message });
  }
}
