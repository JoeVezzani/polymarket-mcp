export const config = {
  runtime: 'edge',
};

// Define available tools
const tools = [
  {
    name: "get-market-info",
    description: "Get detailed information about a specific prediction market",
    inputSchema: {
      type: "object",
      properties: {
        market_id: {
          type: "string",
          description: "Market ID or slug (e.g., 'will-bitcoin-reach-100k-by-2024')"
        }
      },
      required: ["market_id"]
    }
  },
  {
    name: "list-markets",
    description: "List available prediction markets with filtering options",
    inputSchema: {
      type: "object",
      properties: {
        closed: {
          type: "boolean",
          description: "Filter by market status (true for closed, false for open)",
          default: false
        },
        limit: {
          type: "integer",
          description: "Number of markets to return",
          default: 10,
          minimum: 1,
          maximum: 100
        },
        offset: {
          type: "integer",
          description: "Number of markets to skip (for pagination)",
          default: 0,
          minimum: 0
        }
      }
    }
  },
  {
    name: "get-market-prices",
    description: "Get current prices and trading information for a specific market",
    inputSchema: {
      type: "object",
      properties: {
        market_id: {
          type: "string",
          description: "Market ID or slug"
        }
      },
      required: ["market_id"]
    }
  }
];

// Polymarket API helper
async function callPolymarketAPI(endpoint, params) {
  const baseUrl = 'https://gamma-api.polymarket.com';
  const url = new URL(`${baseUrl}${endpoint}`);
  
  if (params) {
    Object.keys(params).forEach(key => {
      if (params[key] !== undefined && params[key] !== null) {
        url.searchParams.append(key, params[key]);
      }
    });
  }
  
  try {
    const response = await fetch(url.toString(), {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Polymarket API error: ${response.status} - ${errorText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Polymarket API error:', error);
    throw error;
  }
}

// Tool execution logic
async function executeTool(name, args) {
  try {
    switch (name) {
      case "get-market-info": {
        // Try to get market info by ID or slug
        const data = await callPolymarketAPI(`/markets/${args.market_id}`);
        
        if (!data) {
          return "Market not found. Please check the market ID or slug.";
        }
        
        return `Title: ${data.question || data.title || 'N/A'}
Category: ${data.category || 'N/A'}
Status: ${data.closed ? 'Closed' : 'Open'}
End Date: ${data.end_date_iso || 'N/A'}
Volume: $${(data.volume || 0).toLocaleString()}
Liquidity: $${(data.liquidity || 0).toLocaleString()}
Outcome Prices: ${data.outcomes ? data.outcomes.map(o => `${o}: $${data.outcomeprices[o] || 'N/A'}`).join(', ') : 'N/A'}
Description: ${data.description || 'No description available'}`;
      }
      
      case "list-markets": {
        const params = {};
        if (args.closed !== undefined) params.closed = args.closed;
        if (args.limit) params.limit = args.limit;
        if (args.offset) params.offset = args.offset;
        
        const data = await callPolymarketAPI('/markets', params);
        
        if (!data || data.length === 0) {
          return "No markets found with the specified criteria.";
        }
        
        let result = `Found ${data.length} markets:\n\n`;
        data.forEach((market, index) => {
          result += `${index + 1}. ${market.question || market.title || 'Untitled Market'}
   ID: ${market.condition_id || market.id || 'N/A'}
   Status: ${market.closed ? 'Closed' : 'Open'}
   Volume: $${(market.volume || 0).toLocaleString()}
   End Date: ${market.end_date_iso || 'N/A'}
---
`;
        });
        return result;
      }
      
      case "get-market-prices": {
        const data = await callPolymarketAPI(`/markets/${args.market_id}`);
        
        if (!data) {
          return "Market not found. Please check the market ID or slug.";
        }
        
        let result = `Market: ${data.question || data.title || 'Unknown Market'}\n\n`;
        
        if (data.outcomes && data.outcomeprices) {
          result += "Current Prices:\n";
          data.outcomes.forEach((outcome) => {
            const price = data.outcomeprices[outcome] || 0;
            result += `${outcome}: $${price.toFixed(4)} (${(price * 100).toFixed(1)}%)\n`;
          });
        } else if (data.tokens && Array.isArray(data.tokens)) {
          result += "Current Prices:\n";
          data.tokens.forEach((token) => {
            const price = token.price || 0;
            result += `${token.outcome}: $${price.toFixed(4)} (${(price * 100).toFixed(1)}%)\n`;
          });
        } else {
          result += "No price data available for this market.";
        }
        
        return result;
      }
      
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    console.error('Tool execution error:', error);
    return `Error: ${error.message}`;
  }
}

// SSE message helper
function sendSSEMessage(encoder, controller, data) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  controller.enqueue(encoder.encode(message));
}

export default async function handler(req) {
  const url = new URL(req.url);
  
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };
  
  // Handle OPTIONS (CORS preflight)
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers });
  }
  
  // Handle SSE endpoint
  if (url.pathname.endsWith('/sse')) {
    console.log('SSE connection established');
    const encoder = new TextEncoder();
    
    const stream = new ReadableStream({
      start(controller) {
        // Send connection established message
        sendSSEMessage(encoder, controller, {
          jsonrpc: "2.0",
          method: "connection.established"
        });
        
        // Keep connection alive with periodic pings
        const keepAlive = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': keepalive\n\n'));
          } catch (e) {
            clearInterval(keepAlive);
          }
        }, 30000);
        
        // Cleanup on abort
        req.signal?.addEventListener('abort', () => {
          clearInterval(keepAlive);
          try {
            controller.close();
          } catch (e) {
            // Already closed
          }
        });
      }
    });
    
    return new Response(stream, {
      headers: {
        ...headers,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }
    });
  }
  
  // Handle messages endpoint
  if (url.pathname.endsWith('/messages') && req.method === 'POST') {
    try {
      const message = await req.json();
      console.log('Received message:', JSON.stringify(message));
      
      let response = {
        jsonrpc: "2.0",
        id: message.id
      };
      
      switch (message.method) {
        case "initialize":
          response.result = {
            protocolVersion: "0.1.0",
            capabilities: {
              tools: {},
              prompts: {}
            },
            serverInfo: {
              name: "polymarket-mcp",
              version: "1.0.0"
            }
          };
          break;
          
        case "tools/list":
          response.result = { tools };
          break;
          
        case "tools/call":
          const callRequest = message.params;
          console.log(`Calling tool: ${callRequest.name} with args:`, callRequest.arguments);
          const result = await executeTool(callRequest.name, callRequest.arguments || {});
          response.result = {
            content: [{ type: "text", text: result }]
          };
          break;
          
        case "prompts/list":
          response.result = { prompts: [] };
          break;
          
        default:
          response.error = {
            code: -32601,
            message: `Method not found: ${message.method}`
          };
      }
      
      console.log('Sending response:', JSON.stringify(response));
      return new Response(JSON.stringify(response), {
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        }
      });
    } catch (error) {
      console.error('Error handling message:', error);
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal error",
            data: error.toString()
          }
        }),
        {
          status: 500,
          headers: {
            ...headers,
            'Content-Type': 'application/json',
          }
        }
      );
    }
  }
  
  // Default response for base URL
  return new Response('Polymarket MCP Server - Working! Use /sse endpoint for SSE connection.', { 
    headers 
  });
}
