import asyncio
import json
from contextlib import asynccontextmanager
from fastapi import FastAPI
import redis.asyncio as redis

redis_client: redis.Redis = None

async def nestjs_redis_listener(client: redis.Redis):
    pubsub = client.pubsub()
    channel_name = "analyze_bp_image"
    await pubsub.subscribe(channel_name)
    print(f"Subscribed to Redis channel: {channel_name}")

    async for message in pubsub.listen():
        if message["type"] == "message":
            try:
                payload = json.loads(message["data"])
                msg_id = payload.get("id") 
                data = payload.get("data")

                print(f"Received message with ID: {msg_id} and data: {data}")
                
                cnn_result = {
                    "systolic": 120,
                    "diastolic": 80,
                    "pulse": 72,
                    "confidence": 0.98
                }

                if msg_id:
                    reply_channel = f"{channel_name}.reply"
                    
                    response_payload = {
                        "id": msg_id,
                        "response": cnn_result,
                        "isDisposed": True 
                    }
                    
                    await client.publish(reply_channel, json.dumps(response_payload))
                    print(f"Reply sent to {reply_channel} for ID: {msg_id}")
                else:
                    print("Missing 'id' in the received message. Cannot send a reply.")

            except Exception as e:
                print(f"Error processing message: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client
    redis_client = redis.Redis(host='localhost', port=6379, decode_responses=True)
    
    task = asyncio.create_task(nestjs_redis_listener(redis_client))
    
    yield
    
    task.cancel()
    await redis_client.close()
    print("Closed Redis connection and stopped listener.")

app = FastAPI(lifespan=lifespan)

@app.get("/")
def read_root():
    return {"status": "AI Service is active and listening to Redis."}