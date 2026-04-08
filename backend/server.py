from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING
import os
import json
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, time, timedelta
import pytz
import firebase_admin
from firebase_admin import credentials, messaging

# Initialize logger
logger = logging.getLogger(__name__)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
db_name = os.environ.get('DB_NAME', 'test_database')

# Handle Atlas SRV connections
import certifi
if 'mongodb+srv' in mongo_url:
    client = AsyncIOMotorClient(mongo_url, tls=True, tlsCAFile=certifi.where())
else:
    client = AsyncIOMotorClient(mongo_url)
db = client[db_name]

app = FastAPI()
api_router = APIRouter(prefix="/api")

INDIA_TZ = pytz.timezone('Asia/Kolkata')
FCM_CHUNK_SIZE = 500  # FCM supports up to 500 tokens per multicast

# Initialize Firebase Admin SDK
def resolve_firebase_credential_path() -> Optional[Path]:
    configured_path = os.environ.get('FIREBASE_SERVICE_ACCOUNT_PATH')
    if configured_path:
        candidate = Path(configured_path)
        if not candidate.is_absolute():
            candidate = ROOT_DIR / candidate
        return candidate

    # Support both legacy and current file names inside backend/.
    for default_name in ('service-account.json', 'firebase-service-account.json'):
        candidate = ROOT_DIR / default_name
        if candidate.exists():
            return candidate

    return None


firebase_cred_path = resolve_firebase_credential_path()
firebase_cred_json = os.environ.get('FIREBASE_SERVICE_ACCOUNT_JSON')  # Alternative: pass JSON string as env var

if not firebase_admin._apps:
    if firebase_cred_json:
        cred_dict = json.loads(firebase_cred_json)
        cred = credentials.Certificate(cred_dict)
    elif firebase_cred_path and firebase_cred_path.exists():
        cred = credentials.Certificate(str(firebase_cred_path))
    else:
        logger.warning("Firebase credentials not found. Push notifications will not work.")
        cred = None

    if cred:
        firebase_admin.initialize_app(cred)
        logger.info("Firebase Admin SDK initialized successfully")
    else:
        logger.warning("Firebase Admin SDK NOT initialized - no credentials")


# Models
class ShopSettings(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    shopId: str = "default"  # Multi-shop support: unique shop identifier
    isOpen: bool = True
    activeDateKey: str
    avgMinutes: int = 15
    activeBarbers: int = 1
    barberPin: str = "1234"
    ownerPin: str = "9999"
    barberSessionResetAt: Optional[datetime] = None
    updatedAt: datetime = Field(default_factory=datetime.utcnow)


# New: Shop model for multi-shop system
class Shop(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    shopId: str  # Unique identifier like "style", "royal"
    name: str  # Display name like "Style Salon"
    username: str  # For barber login
    password: str  # Plain password (simple system)
    openTime: str = "09:00"
    closeTime: str = "22:00"  # Default to 10 PM for late closing shops
    waitingTimer: int = 15  # Minutes before customer expires
    activeBarbers: int = 1
    isOpen: bool = True
    closedDays: List[int] = Field(default_factory=lambda: [])  # Empty by default, shop owner can set
    createdAt: datetime = Field(default_factory=datetime.utcnow)
    updatedAt: datetime = Field(default_factory=datetime.utcnow)


# New: Barber model for barber-specific queues
class Barber(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    shopId: str  # Which shop this barber belongs to
    name: str  # Barber's name (e.g., "Rahul", "Amit")
    isActive: bool = True  # Whether barber is currently working
    chairNumber: int = 1  # Which chair this barber uses
    createdAt: datetime = Field(default_factory=datetime.utcnow)


class QueueEntry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    shopId: str = "default"  # Multi-shop support
    dateKey: str
    tokenNumber: int
    name: str
    phone: Optional[str] = None
    status: str = "waiting"  # waiting, serving, completed, left, skipped, expired
    chairNumber: Optional[int] = None  # assigned when serving
    addedBy: str = "customer"  # "customer" or "barber"
    barberId: Optional[str] = None  # For barber-specific queues
    serviceStartedAt: Optional[datetime] = None  # When START button pressed
    expiresAt: Optional[datetime] = None  # Timer expiry for serving customers
    createdAt: datetime = Field(default_factory=datetime.utcnow)
    completedAt: Optional[datetime] = None


class JoinQueueRequest(BaseModel):
    name: str
    phone: Optional[str] = None
    addedBy: Optional[str] = "customer"
    shopId: Optional[str] = "default"  # Multi-shop support
    barberId: Optional[str] = None  # For barber-specific queues


class RegisterDeviceRequest(BaseModel):
    token: str
    platform: str = "unknown"
    userType: str
    shopId: Optional[str] = None
    barberId: Optional[str] = None
    entryId: Optional[str] = None
    enabled: bool = True


class UnregisterDeviceRequest(BaseModel):
    token: str
    userType: Optional[str] = None
    entryId: Optional[str] = None


class NotificationTestRequest(BaseModel):
    token: Optional[str] = None
    userType: Optional[str] = None
    shopId: Optional[str] = None
    title: str = "Quevix Test"
    body: str = "Test notification from Quevix"
    data: Dict[str, Any] = Field(default_factory=dict)


def is_valid_fcm_token(token: str) -> bool:
    """FCM tokens are long strings (100+ chars), not empty, no spaces."""
    if not token or len(token) < 20:
        return False
    return True


def chunk_list(items: List[Any], size: int):
    for i in range(0, len(items), size):
        yield items[i:i + size]


async def disable_device_tokens(tokens: List[str]):
    if not tokens:
        return
    await db.device_tokens.update_many(
        {"token": {"$in": tokens}},
        {"$set": {"enabled": False, "updatedAt": datetime.utcnow()}}
    )


async def disable_customer_entry_tokens(entry_id: str):
    if not entry_id:
        return
    await db.device_tokens.update_many(
        {"userType": "customer", "entryId": entry_id},
        {"$set": {"enabled": False, "updatedAt": datetime.utcnow()}}
    )


async def get_enabled_tokens(query: Dict[str, Any], limit: int = 500) -> List[str]:
    full_query = {**query, "enabled": True}
    logger.info(f"[TOKENS] Querying device_tokens with: {full_query}")
    docs = await db.device_tokens.find(full_query, {"token": 1}).to_list(limit)
    logger.info(f"[TOKENS] Matched {len(docs)} document(s) in device_tokens collection")
    seen = set()
    tokens = []
    for doc in docs:
        token = doc.get("token")
        if token and token not in seen:
            seen.add(token)
            tokens.append(token)
    return tokens


async def send_fcm_notifications(messages: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Send push notifications via Firebase Cloud Messaging."""
    logger.info(f"[FCM] send_fcm_notifications called with {len(messages)} message(s)")
    if not messages:
        return {"sent": 0, "failed": 0, "errors": []}

    if not firebase_admin._apps:
        logger.warning("Firebase not initialized, skipping FCM send")
        return {"sent": 0, "failed": 0, "errors": [{"error": "firebase-not-initialized"}]}

    import asyncio

    invalid_tokens = set()
    errors = []
    sent_count = 0

    def _send_one(msg):
        """Synchronous FCM send (firebase-admin is sync)."""
        token = msg.get("to")
        if not is_valid_fcm_token(token):
            return ("invalid", token)

        fcm_message = messaging.Message(
            token=token,
            notification=messaging.Notification(
                title=msg.get("title", "Quevix"),
                body=msg.get("body", ""),
            ),
            data={k: str(v) for k, v in msg.get("data", {}).items()},
            android=messaging.AndroidConfig(
                priority="high",
                notification=messaging.AndroidNotification(
                    sound="default",
                    priority="high",
                ),
            ),
        )
        response = messaging.send(fcm_message)
        return ("ok", response)

    loop = asyncio.get_event_loop()

    for idx, msg in enumerate(messages):
        token = msg.get("to")
        logger.info(f"[FCM] Sending message {idx+1}/{len(messages)}: title='{msg.get('title')}', to={token[:20] if token else '?'}...")
        try:
            status, result = await loop.run_in_executor(None, _send_one, msg)
            if status == "invalid":
                if result:
                    invalid_tokens.add(result)
            else:
                logger.info(f"FCM sent OK: {result}")
                sent_count += 1
        except messaging.UnregisteredError:
            logger.warning(f"FCM token unregistered: {token[:20]}...")
            invalid_tokens.add(token)
            errors.append({"token": token[:20], "error": "UnregisteredError"})
        except (ValueError, firebase_admin.exceptions.InvalidArgumentError) as e:
            logger.warning(f"FCM invalid argument (token may be stale): {e}")
            # Don't disable on InvalidArgument — token may just be stale and will be re-registered
            errors.append({"token": token[:20], "error": f"InvalidArgument: {e}"})
        except Exception as e:
            logger.error(f"FCM send failed for {token[:20] if token else '?'}: {e}")
            errors.append({"token": token[:20] if token else "?", "error": str(e)})

    if invalid_tokens:
        await disable_device_tokens(list(invalid_tokens))

    return {
        "sent": sent_count,
        "failed": len(errors) + len(invalid_tokens),
        "errors": errors[:25],
    }


async def notify_barbers_for_join(shop_id: str, entry_id: str, token_number: int, customer_name: str, barber_id: Optional[str]):
    query: Dict[str, Any] = {"userType": "barber", "shopId": shop_id}
    if barber_id:
        query["$or"] = [
            {"barberId": barber_id},
            {"barberId": None},
            {"barberId": {"$exists": False}}
        ]

    logger.info(f"[NOTIFY] notify_barbers_for_join: shop={shop_id}, token=#{token_number}, query={query}")
    tokens = await get_enabled_tokens(query)
    logger.info(f"[NOTIFY] Found {len(tokens)} barber device(s) for shop {shop_id}")
    if not tokens:
        logger.info(f"[NOTIFY] No barber devices registered for shop {shop_id}, skipping notification")
        return

    data = {
        "type": "queue_join",
        "shopId": shop_id,
        "entryId": entry_id,
        "tokenNumber": str(token_number),
    }
    if barber_id:
        data["barberId"] = barber_id

    messages = [{
        "to": token,
        "title": "New Queue Entry",
        "body": f"#{token_number} {customer_name} joined the queue",
        "data": data,
    } for token in tokens]

    logger.info(f"[NOTIFY] Sending {len(messages)} FCM message(s) to barbers")
    result = await send_fcm_notifications(messages)
    logger.info(f"[NOTIFY] FCM result: {result}")


async def notify_customer_called(shop_id: str, entry: Dict[str, Any]):
    entry_id = entry.get("id")
    if not entry_id:
        logger.warning("[NOTIFY] notify_customer_called: no entry_id, skipping")
        return

    logger.info(f"[NOTIFY] notify_customer_called: shop={shop_id}, entry={entry_id}, token=#{entry.get('tokenNumber')}")
    tokens = await get_enabled_tokens({"userType": "customer", "shopId": shop_id, "entryId": entry_id})
    logger.info(f"[NOTIFY] Found {len(tokens)} customer device(s) for entry {entry_id}")
    if not tokens:
        logger.info(f"[NOTIFY] No customer devices for entry {entry_id}, skipping")
        return

    data = {
        "type": "called",
        "shopId": shop_id,
        "entryId": entry_id,
        "tokenNumber": str(entry.get("tokenNumber", "")),
    }
    if entry.get("chairNumber") is not None:
        data["chairNumber"] = str(entry["chairNumber"])

    messages = [{
        "to": token,
        "title": "It Is Your Turn",
        "body": f"Token #{entry.get('tokenNumber')} please go to the chair now.",
        "data": data,
    } for token in tokens]

    logger.info(f"[NOTIFY] Sending {len(messages)} FCM message(s) to customer")
    result = await send_fcm_notifications(messages)
    logger.info(f"[NOTIFY] FCM result: {result}")


async def notify_customer_status(shop_id: str, entry: Dict[str, Any], event_type: str):
    entry_id = entry.get("id")
    if not entry_id:
        return

    logger.info(f"[NOTIFY] notify_customer_status: shop={shop_id}, entry={entry_id}, event={event_type}")
    tokens = await get_enabled_tokens({"userType": "customer", "shopId": shop_id, "entryId": entry_id})
    logger.info(f"[NOTIFY] Found {len(tokens)} customer device(s) for entry {entry_id}")
    if not tokens:
        logger.info(f"[NOTIFY] No customer devices for entry {entry_id}, skipping")
        return

    if event_type == "skipped":
        title = "Token Skipped"
        body = f"Token #{entry.get('tokenNumber')} was skipped. Please take a new token."
    elif event_type == "expired":
        title = "Token Expired"
        body = f"Token #{entry.get('tokenNumber')} expired. Please rejoin the queue."
    else:
        title = "Queue Update"
        body = f"Token #{entry.get('tokenNumber')} status changed to {event_type}."

    data = {
        "type": event_type,
        "shopId": shop_id,
        "entryId": entry_id,
        "tokenNumber": str(entry.get("tokenNumber", "")),
    }

    messages = [{
        "to": token,
        "title": title,
        "body": body,
        "data": data,
    } for token in tokens]

    logger.info(f"[NOTIFY] Sending {len(messages)} FCM message(s) for event={event_type}")
    result = await send_fcm_notifications(messages)
    logger.info(f"[NOTIFY] FCM result: {result}")


# Helper functions
def get_today_key():
    india_now = datetime.now(INDIA_TZ)
    return india_now.strftime("%Y-%m-%d")


def get_current_india_time():
    return datetime.now(INDIA_TZ)


def is_schedule_open():
    india_now = get_current_india_time()
    if india_now.weekday() == 1:  # Tuesday closed
        return False
    return True


async def get_shop_settings():
    settings = await db.shop_settings.find_one()
    if not settings:
        today = get_today_key()
        default_settings = ShopSettings(activeDateKey=today)
        await db.shop_settings.insert_one(default_settings.dict())
        settings = default_settings.dict()
    if settings and '_id' in settings:
        del settings['_id']
    return settings


# ============================================================================
# MULTI-SHOP HELPER FUNCTIONS
# ============================================================================

async def get_shop_by_id(shop_id: str):
    """Get shop by shopId"""
    shop = await db.shops.find_one({"shopId": shop_id})
    if shop and '_id' in shop:
        del shop['_id']
    return shop


async def get_shop_settings_for_shop(shop_id: str = "default"):
    """Get settings for a specific shop. Falls back to default if not found."""
    if shop_id and shop_id != "default":
        shop = await get_shop_by_id(shop_id)
        if shop:
            return {
                "shopId": shop["shopId"],
                "name": shop.get("name", shop["shopId"]),
                "isOpen": shop.get("isOpen", True),
                "openTime": shop.get("openTime", "09:00"),
                "closeTime": shop.get("closeTime", "22:00"),
                "waitingTimer": shop.get("waitingTimer", 15),
                "activeBarbers": shop.get("activeBarbers", 1),
                "closedDays": shop.get("closedDays", []),
            }
    # Fallback to default settings
    return await get_shop_settings()


def parse_time_to_minutes(time_str: str) -> int:
    """Parse time string (HH:MM, H:MM, or AM/PM format) to minutes since midnight"""
    time_str = time_str.strip().upper()
    
    # Handle AM/PM formats like "9AM", "9:00 AM", "9 AM", "10PM", "10:00 PM"
    is_pm = 'PM' in time_str
    is_am = 'AM' in time_str
    
    # Remove AM/PM
    time_str = time_str.replace('PM', '').replace('AM', '').replace('P', '').replace('A', '').strip()
    
    # Parse hours and minutes
    if ':' in time_str:
        parts = time_str.split(':')
        hours = int(parts[0])
        minutes = int(parts[1]) if len(parts) > 1 else 0
    else:
        hours = int(time_str)
        minutes = 0
    
    # Convert to 24-hour format
    if is_pm and hours < 12:
        hours += 12
    elif is_am and hours == 12:
        hours = 0
    
    return hours * 60 + minutes


async def is_shop_open(shop_id: str = "default"):
    """Check if a specific shop is currently open"""
    if shop_id and shop_id != "default":
        shop = await get_shop_by_id(shop_id)
        if shop:
            if not shop.get("isOpen", True):
                return False
            # Check shop hours using proper time comparison
            india_now = get_current_india_time()
            open_time_str = shop.get("openTime", "09:00")
            close_time_str = shop.get("closeTime", "22:00")
            
            try:
                current_minutes = india_now.hour * 60 + india_now.minute
                open_minutes = parse_time_to_minutes(open_time_str)
                close_minutes = parse_time_to_minutes(close_time_str)
                
                # Handle overnight hours (e.g., 10PM - 2AM)
                if close_minutes < open_minutes:
                    # Shop is open if current time is after open OR before close
                    if current_minutes < open_minutes and current_minutes > close_minutes:
                        return False
                else:
                    # Normal hours
                    if current_minutes < open_minutes or current_minutes > close_minutes:
                        return False
            except Exception as e:
                logging.warning(f"Time parsing error for shop {shop_id}: {e}")
                pass  # If time parsing fails, consider it open
            
            # Check closed days - empty list means open all days
            closed_days = shop.get("closedDays", [])
            if closed_days and india_now.weekday() in closed_days:
                return False
            return True
    # Fallback to default shop logic
    return await is_effectively_open()


async def is_effectively_open():
    settings = await get_shop_settings()
    today = get_today_key()
    manual_open = settings.get('isOpen', True)
    correct_date = settings.get('activeDateKey') == today

    # If owner opened shop for today, override schedule
    if correct_date and manual_open:
        return True
    # If owner closed shop for today, respect that
    if correct_date and not manual_open:
        return False
    # No action today: follow schedule
    return is_schedule_open()


# ============================================================================
# SETTINGS API (Updated for Multi-Shop)
# ============================================================================

@api_router.get("/settings")
async def get_settings(shop: str = None):
    """Get shop settings. Supports optional shop parameter for multi-shop."""
    shop_id = shop or "default"
    
    if shop_id != "default":
        shop_data = await get_shop_by_id(shop_id)
        if shop_data:
            is_open = await is_shop_open(shop_id)
            return {
                "settings": {
                    "shopId": shop_data["shopId"],
                    "shopName": shop_data.get("name", shop_data["shopId"]),
                    "name": shop_data.get("name", shop_data["shopId"]),
                    "isOpen": shop_data.get("isOpen", True),
                    "openTime": shop_data.get("openTime", "09:00"),
                    "closeTime": shop_data.get("closeTime", "21:00"),
                    "activeBarbers": shop_data.get("activeBarbers", 1),
                    "avgMinutes": shop_data.get("waitingTimer", 15),
                    "waitingTimer": shop_data.get("waitingTimer", 15),
                },
                "scheduleOpen": is_open,
                "effectivelyOpen": is_open,
                "currentTime": get_current_india_time().isoformat()
            }
    
    # Default shop (backward compatible)
    settings = await get_shop_settings()
    schedule_open = is_schedule_open()
    effectively_open = await is_effectively_open()
    return {
        "settings": settings,
        "scheduleOpen": schedule_open,
        "effectivelyOpen": effectively_open,
        "currentTime": get_current_india_time().isoformat()
    }


# ============================================================================
# ADMIN APIS
# ============================================================================

@api_router.post("/admin/verify-pin")
async def verify_pin(pin_data: dict):
    pin = pin_data.get("pin")
    pin_type = pin_data.get("type")
    settings = await get_shop_settings()
    if pin_type == "owner":
        if pin == settings.get("ownerPin"):
            return {"success": True, "type": "owner"}
    elif pin_type == "barber":
        if pin == settings.get("barberPin"):
            return {"success": True, "type": "barber"}
    return {"success": False}


@api_router.post("/admin/open-shop")
async def open_shop():
    today = get_today_key()
    await db.shop_settings.update_one(
        {},
        {"$set": {"isOpen": True, "activeDateKey": today, "updatedAt": datetime.utcnow()}}
    )
    return {"success": True, "message": "Shop opened", "dateKey": today}


@api_router.post("/admin/close-shop")
async def close_shop(data: dict):
    clear_waiting = data.get("clearWaiting", False)
    today = get_today_key()
    await db.shop_settings.update_one(
        {},
        {"$set": {"isOpen": False, "activeDateKey": today, "updatedAt": datetime.utcnow()}}
    )
    if clear_waiting:
        await db.queue_entries.update_many(
            {"dateKey": today, "status": "waiting"},
            {"$set": {"status": "left"}}
        )
    return {"success": True, "message": "Shop closed"}


@api_router.post("/admin/set-active-barbers")
async def set_active_barbers(data: dict):
    count = data.get("activeBarbers")
    if not count or count < 1 or count > 10:
        raise HTTPException(status_code=400, detail="activeBarbers must be 1-10")
    await db.shop_settings.update_one(
        {},
        {"$set": {"activeBarbers": count, "updatedAt": datetime.utcnow()}}
    )
    return {"success": True, "activeBarbers": count}


@api_router.post("/admin/set-avg-time")
async def set_avg_time(data: dict):
    avg_minutes = data.get("avgMinutes")
    if not avg_minutes or avg_minutes < 5 or avg_minutes > 60:
        raise HTTPException(status_code=400, detail="Invalid avgMinutes (5-60)")
    await db.shop_settings.update_one(
        {},
        {"$set": {"avgMinutes": avg_minutes, "updatedAt": datetime.utcnow()}}
    )
    return {"success": True, "avgMinutes": avg_minutes}


@api_router.post("/admin/change-barber-pin")
async def change_barber_pin(data: dict):
    new_pin = data.get("newPin")
    if not new_pin or len(str(new_pin)) != 4:
        raise HTTPException(status_code=400, detail="PIN must be 4 digits")
    await db.shop_settings.update_one(
        {},
        {"$set": {"barberPin": str(new_pin), "updatedAt": datetime.utcnow()}}
    )
    return {"success": True, "message": "Barber PIN updated"}


@api_router.post("/admin/remove-token")
async def remove_token(data: dict):
    token_number = data.get("tokenNumber")
    today = get_today_key()
    result = await db.queue_entries.update_one(
        {"dateKey": today, "tokenNumber": token_number, "status": {"$in": ["waiting", "serving"]}},
        {"$set": {"status": "left"}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=f"Token #{token_number} not found in active queue")
    return {"success": True, "message": f"Removed token #{token_number}"}


@api_router.post("/admin/reset-barber-session")
async def reset_barber_session():
    await db.shop_settings.update_one(
        {},
        {"$set": {"barberSessionResetAt": datetime.utcnow(), "updatedAt": datetime.utcnow()}}
    )
    return {"success": True, "message": "Barber session reset."}


# ============================================================================
# MULTI-SHOP MANAGEMENT APIs (NEW)
# ============================================================================

@api_router.post("/admin/login")
async def admin_login(data: dict):
    """Admin login with master credentials"""
    username = data.get("username")
    password = data.get("password")
    # Master admin credentials from environment variables
    admin_user = os.environ.get("ADMIN_USERNAME", "admin")
    admin_pass = os.environ.get("ADMIN_PASSWORD", "admin123")
    if username == admin_user and password == admin_pass:
        return {"success": True, "role": "admin"}
    return {"success": False, "message": "Invalid credentials"}


@api_router.post("/shop/login")
async def shop_login(data: dict):
    """Barber login with shop credentials"""
    username = data.get("username")
    password = data.get("password")
    
    # Find shop by username
    shop = await db.shops.find_one({"username": username})
    if shop and shop.get("password") == password:
        return {
            "success": True,
            "shopId": shop["shopId"],
            "shopName": shop.get("name", shop["shopId"]),
            "activeBarbers": shop.get("activeBarbers", 1),
            "waitingTimer": shop.get("waitingTimer", 15)
        }
    
    # Fallback: check if username matches barberPin from default settings
    settings = await get_shop_settings()
    if username == settings.get("barberPin") or password == settings.get("barberPin"):
        target_shop_id = username if username else "default"
        is_pin_as_user = (username == settings.get("barberPin"))
        if is_pin_as_user:
            target_shop_id = "default" # Only fallback to default if they literally typed the PIN as the username
            
        return {
            "success": True,
            "shopId": target_shop_id,
            "shopName": f"{target_shop_id} Shop".title(),
            "activeBarbers": settings.get("activeBarbers", 1),
            "waitingTimer": settings.get("avgMinutes", 15)
        }
    
    return {"success": False, "message": "Invalid username or password"}


@api_router.get("/admin/shops")
async def list_shops():
    """List all shops (admin only)"""
    shops = await db.shops.find().to_list(100)
    shop_list = []
    for shop in shops:
        if '_id' in shop:
            del shop['_id']
        # Don't expose password
        shop.pop('password', None)
        shop_list.append(shop)
    return {"shops": shop_list}


@api_router.post("/admin/shops")
async def create_shop(data: dict):
    """Create a new shop (admin only)"""
    shop_id = data.get("shopId")
    name = data.get("name", shop_id)
    username = data.get("username")
    password = data.get("password")
    
    if not shop_id or not username or not password:
        raise HTTPException(status_code=400, detail="shopId, username, and password are required")
    
    # Check if shopId or username already exists
    existing = await db.shops.find_one({"$or": [{"shopId": shop_id}, {"username": username}]})
    if existing:
        raise HTTPException(status_code=400, detail="Shop ID or username already exists")
    
    new_shop = Shop(
        shopId=shop_id,
        name=name,
        username=username,
        password=password,
        openTime=data.get("openTime", "09:00"),
        closeTime=data.get("closeTime", "21:00"),
        waitingTimer=data.get("waitingTimer", 15),
        activeBarbers=data.get("activeBarbers", 1),
        isOpen=data.get("isOpen", True),
        closedDays=data.get("closedDays", [])
    )
    await db.shops.insert_one(new_shop.dict())
    
    return {"success": True, "message": f"Shop '{name}' created", "shopId": shop_id}


@api_router.put("/admin/shops/{shop_id}")
async def update_shop(shop_id: str, data: dict):
    """Update shop settings (admin only)"""
    update_data = {"updatedAt": datetime.utcnow()}
    
    allowed_fields = ["name", "username", "password", "openTime", "closeTime", 
                      "waitingTimer", "activeBarbers", "isOpen", "closedDays"]
    for field in allowed_fields:
        if field in data:
            update_data[field] = data[field]
    
    result = await db.shops.update_one(
        {"shopId": shop_id},
        {"$set": update_data}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Shop not found")
    
    return {"success": True, "message": f"Shop '{shop_id}' updated"}


@api_router.delete("/admin/shops/{shop_id}")
async def delete_shop(shop_id: str):
    """Delete a shop (admin only)"""
    result = await db.shops.delete_one({"shopId": shop_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Shop not found")
    return {"success": True, "message": f"Shop '{shop_id}' deleted"}


# ============================================================================
# BARBER MANAGEMENT APIs
# ============================================================================

@api_router.get("/shop/{shop_id}/barbers")
async def get_shop_barbers(shop_id: str):
    """Get all barbers for a shop"""
    barbers = await db.barbers.find({"shopId": shop_id}).to_list(50)
    barber_list = []
    for b in barbers:
        if '_id' in b:
            del b['_id']
        barber_list.append(b)
    return {"barbers": barber_list}


@api_router.post("/shop/{shop_id}/barbers")
async def create_barber(shop_id: str, data: dict):
    """Add a new barber to a shop"""
    name = data.get("name")
    if not name:
        raise HTTPException(status_code=400, detail="Barber name is required")
    
    # Get next chair number
    existing_barbers = await db.barbers.find({"shopId": shop_id}).to_list(50)
    next_chair = len(existing_barbers) + 1
    
    new_barber = Barber(
        shopId=shop_id,
        name=name,
        isActive=data.get("isActive", True),
        chairNumber=data.get("chairNumber", next_chair)
    )
    await db.barbers.insert_one(new_barber.dict())
    
    # Update shop's activeBarbers count
    await db.shops.update_one(
        {"shopId": shop_id},
        {"$set": {"activeBarbers": next_chair}}
    )
    
    return {"success": True, "barberId": new_barber.id, "name": name, "chairNumber": new_barber.chairNumber}


@api_router.put("/shop/{shop_id}/barbers/{barber_id}")
async def update_barber(shop_id: str, barber_id: str, data: dict):
    """Update a barber"""
    update_data = {}
    if "name" in data:
        update_data["name"] = data["name"]
    if "isActive" in data:
        update_data["isActive"] = data["isActive"]
    if "chairNumber" in data:
        update_data["chairNumber"] = data["chairNumber"]
    
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    result = await db.barbers.update_one(
        {"id": barber_id, "shopId": shop_id},
        {"$set": update_data}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Barber not found")
    
    return {"success": True, "message": "Barber updated"}


@api_router.delete("/shop/{shop_id}/barbers/{barber_id}")
async def delete_barber(shop_id: str, barber_id: str):
    """Delete a barber"""
    result = await db.barbers.delete_one({"id": barber_id, "shopId": shop_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Barber not found")
    
    # Update shop's activeBarbers count
    remaining = await db.barbers.count_documents({"shopId": shop_id})
    await db.shops.update_one(
        {"shopId": shop_id},
        {"$set": {"activeBarbers": max(1, remaining)}}
    )
    
    return {"success": True, "message": "Barber deleted"}


@api_router.post("/shop/{shop_id}/open")
async def open_specific_shop(shop_id: str):
    """Open a specific shop"""
    result = await db.shops.update_one(
        {"shopId": shop_id},
        {"$set": {"isOpen": True, "updatedAt": datetime.utcnow()}}
    )
    if result.matched_count == 0:
        # Fallback to default shop
        await open_shop()
    return {"success": True, "message": f"Shop '{shop_id}' opened"}


@api_router.post("/shop/{shop_id}/close")
async def close_specific_shop(shop_id: str, data: dict = None):
    """Close a specific shop"""
    result = await db.shops.update_one(
        {"shopId": shop_id},
        {"$set": {"isOpen": False, "updatedAt": datetime.utcnow()}}
    )
    if result.matched_count == 0:
        # Fallback to default shop
        await close_shop(data or {})
    return {"success": True, "message": f"Shop '{shop_id}' closed"}


# ============================================================================
# MULTI-SHOP QUEUE APIs (START, SKIP, Timer)
# ============================================================================

@api_router.get("/queue/{shop_id}/dashboard")
async def get_shop_dashboard(shop_id: str, barber_id: str = None):
    """Get dashboard for a specific shop, optionally filtered by barber"""
    today = get_today_key()
    
    # Get shop settings
    shop = await get_shop_by_id(shop_id)
    active_barbers = shop.get("activeBarbers", 1) if shop else 1
    waiting_timer = shop.get("waitingTimer", 15) if shop else 15
    
    # Base query filter
    query_filter = {"dateKey": today, "shopId": shop_id}
    
    # Get all barbers for name lookup
    barbers_list = await db.barbers.find({"shopId": shop_id}).to_list(50)
    barber_map = {b["id"]: b["name"] for b in barbers_list}
    barber_list = [{"id": b["id"], "name": b["name"], "chairNumber": b.get("chairNumber", 1), "isActive": b.get("isActive", True)} for b in barbers_list]
    
    # If barber_id provided, filter by that barber OR general queue (barberId=null)
    if barber_id:
        # Serving: only this barber
        serving_entries = await db.queue_entries.find(
            {**query_filter, "status": "serving", "barberId": barber_id}
        ).sort("tokenNumber", 1).to_list(100)
        
        # Waiting: this barber's queue + general queue
        barber_waiting = await db.queue_entries.find(
            {**query_filter, "status": "waiting", "barberId": barber_id}
        ).sort("tokenNumber", 1).to_list(1000)
        general_waiting = await db.queue_entries.find(
            {**query_filter, "status": "waiting", "barberId": None}
        ).sort("tokenNumber", 1).to_list(1000)
        waiting_entries = barber_waiting + general_waiting
        waiting_entries.sort(key=lambda x: x["tokenNumber"])
        
        # Completed: this barber
        completed_entries = await db.queue_entries.find(
            {**query_filter, "status": "completed", "barberId": barber_id}
        ).sort("completedAt", -1).to_list(100)
        
        serving_count = len(serving_entries)
        waiting_count = len(waiting_entries)
        completed_count = len(completed_entries)
    else:
        # No filter - get all
        serving_entries = await db.queue_entries.find(
            {**query_filter, "status": "serving"}
        ).sort("tokenNumber", 1).to_list(100)
        
        waiting_entries = await db.queue_entries.find(
            {**query_filter, "status": "waiting"}
        ).sort("tokenNumber", 1).to_list(1000)
        
        completed_entries = await db.queue_entries.find(
            {**query_filter, "status": "completed"}
        ).sort("completedAt", -1).to_list(100)
        
        serving_count = len(serving_entries)
        waiting_count = len(waiting_entries)
        completed_count = len(completed_entries)
    
    def fmt_dt(val):
        if isinstance(val, datetime):
            return val.isoformat()
        return str(val) if val else ""
    
    def get_barber_name(bid):
        return barber_map.get(bid, "") if bid else ""
    
    serving_list = [{
        "id": e["id"],
        "tokenNumber": e["tokenNumber"],
        "name": e["name"],
        "chairNumber": e.get("chairNumber"),
        "barberId": e.get("barberId"),
        "barberName": get_barber_name(e.get("barberId")),
        "serviceStartedAt": fmt_dt(e.get("serviceStartedAt")),
        "expiresAt": fmt_dt(e.get("expiresAt")),
        "createdAt": fmt_dt(e["createdAt"])
    } for e in serving_entries]
    
    waiting_list = [{
        "id": e["id"],
        "tokenNumber": e["tokenNumber"],
        "name": e["name"],
        "barberId": e.get("barberId"),
        "barberName": get_barber_name(e.get("barberId")),
        "createdAt": fmt_dt(e["createdAt"])
    } for e in waiting_entries]
    
    completed_list = [{
        "id": e["id"],
        "tokenNumber": e["tokenNumber"],
        "name": e["name"],
        "barberId": e.get("barberId"),
        "barberName": get_barber_name(e.get("barberId")),
        "completedAt": fmt_dt(e.get("completedAt"))
    } for e in completed_entries]
    
    return {
        "shopId": shop_id,
        "activeBarbers": active_barbers,
        "waitingTimer": waiting_timer,
        "servingCount": serving_count,
        "waitingCount": waiting_count,
        "completedCount": completed_count,
        "servingList": serving_list,
        "waitingList": waiting_list,
        "completedList": completed_list,
        "barbers": barber_list
    }


@api_router.post("/queue/{shop_id}/start-next")
async def start_next_for_shop(shop_id: str, barber_id: str = None):
    """Move next waiting customer to serving for a specific shop/barber with timer"""
    today = get_today_key()
    
    # Get shop settings
    shop = await get_shop_by_id(shop_id)
    active_barbers = shop.get("activeBarbers", 1) if shop else 1
    waiting_timer = shop.get("waitingTimer", 15) if shop else 15
    
    # Query filter for this shop
    query_filter = {"dateKey": today}
    if shop_id != "default":
        query_filter["shopId"] = shop_id
    
    # Get barber info if specified
    barber = None
    if barber_id:
        barber = await db.barbers.find_one({"id": barber_id, "shopId": shop_id})
    
    # Get occupied chair numbers
    serving_entries = await db.queue_entries.find(
        {**query_filter, "status": "serving"}
    ).to_list(100)
    occupied_chairs = {e.get("chairNumber") for e in serving_entries if e.get("chairNumber")}
    
    if len(serving_entries) >= active_barbers:
        raise HTTPException(status_code=400, detail="All chairs are occupied")
    
    # Find first available chair (or use barber's chair)
    if barber and barber.get("chairNumber"):
        available_chair = barber["chairNumber"]
    else:
        available_chair = None
        for c in range(1, active_barbers + 1):
            if c not in occupied_chairs:
                available_chair = c
                break
        if available_chair is None:
            available_chair = len(serving_entries) + 1
    
    # Find next waiting customer
    # STRICT RULE: 
    # 1. First look for customers assigned to this specific barber
    # 2. Then look in general queue (barberId = null)
    # 3. NEVER take customers assigned to another barber
    next_entry = None
    if barber_id:
        # First look for customers assigned to this specific barber
        next_entry = await db.queue_entries.find_one(
            {**query_filter, "status": "waiting", "barberId": barber_id},
            sort=[("tokenNumber", 1)]
        )
    
    if not next_entry:
        # Then look in general queue (no barber assigned) - these can go to any barber
        next_entry = await db.queue_entries.find_one(
            {**query_filter, "status": "waiting", "barberId": None},
            sort=[("tokenNumber", 1)]
        )
    
    # DO NOT fall back to "any customer" - respect barber assignments strictly
    
    if not next_entry:
        raise HTTPException(status_code=404, detail="No waiting customers")
    
    # Update entry with serving status and assign to barber if specified
    update_data = {
        "status": "serving",
        "chairNumber": available_chair,
    }
    
    # Only set expiry time if timer is enabled (> 0)
    if waiting_timer > 0:
        expires_at = datetime.utcnow() + timedelta(minutes=waiting_timer)
        update_data["expiresAt"] = expires_at
    else:
        update_data["expiresAt"] = None  # Timer disabled
    
    if barber_id:
        update_data["barberId"] = barber_id
    
    await db.queue_entries.update_one(
        {"id": next_entry["id"]},
        {"$set": update_data}
    )

    try:
        await notify_customer_called(shop_id, {**next_entry, **update_data})
    except Exception as notify_exc:
        logger.warning(f"Failed to notify called customer {next_entry.get('id')}: {notify_exc}")
    
    return {
        "success": True,
        "message": f"Token #{next_entry['tokenNumber']} ({next_entry['name']}) → Chair {available_chair}",
        "tokenNumber": next_entry["tokenNumber"],
        "name": next_entry["name"],
        "chairNumber": available_chair,
        "barberId": barber_id,
        "expiresAt": update_data.get("expiresAt").isoformat() if update_data.get("expiresAt") else None
    }


@api_router.post("/queue/{shop_id}/start/{entry_id}")
async def mark_service_started(shop_id: str, entry_id: str):
    """Mark that service has actually started (clears the expiry timer)"""
    entry = await db.queue_entries.find_one({"id": entry_id, "status": "serving"})
    if not entry:
        raise HTTPException(status_code=404, detail="Serving entry not found")
    
    await db.queue_entries.update_one(
        {"id": entry_id},
        {"$set": {
            "serviceStartedAt": datetime.utcnow(),
            "expiresAt": None  # Clear expiry timer - customer has arrived
        }}
    )
    
    return {
        "success": True,
        "message": f"Service started for Token #{entry['tokenNumber']}",
        "tokenNumber": entry["tokenNumber"],
        "name": entry["name"]
    }


@api_router.post("/queue/{shop_id}/skip/{entry_id}")
async def skip_customer(shop_id: str, entry_id: str, barber_id: str = None):
    """Skip a customer - they must take a new token"""
    entry = await db.queue_entries.find_one({"id": entry_id, "status": "serving"})
    if not entry:
        raise HTTPException(status_code=404, detail="Serving entry not found")
    
    today = get_today_key()
    freed_chair = entry.get("chairNumber")
    serving_barber_id = entry.get("barberId") or barber_id
    
    # Mark as skipped
    await db.queue_entries.update_one(
        {"id": entry_id},
        {"$set": {
            "status": "skipped",
            "chairNumber": None,
            "completedAt": datetime.utcnow()
        }}
    )

    try:
        await notify_customer_status(shop_id, entry, "skipped")
    except Exception as notify_exc:
        logger.warning(f"Failed to notify skipped customer {entry_id}: {notify_exc}")

    await disable_customer_entry_tokens(entry_id)
    
    # Get shop settings
    shop = await get_shop_by_id(shop_id)
    waiting_timer = shop.get("waitingTimer", 15) if shop else 15
    
    # Auto-start next customer for the same barber/chair
    # STRICT RULE: Only pick from this barber's queue or general queue
    auto_started = None
    query_filter = {"dateKey": today, "status": "waiting"}
    if shop_id != "default":
        query_filter["shopId"] = shop_id
    
    # Find next customer: STRICTLY this barber's queue, then general queue only
    next_entry = None
    if serving_barber_id:
        # First look for customers assigned to this specific barber
        next_entry = await db.queue_entries.find_one(
            {**query_filter, "barberId": serving_barber_id},
            sort=[("tokenNumber", 1)]
        )
    
    if not next_entry:
        # Then look in general queue (barberId = null) - can go to any barber
        next_entry = await db.queue_entries.find_one(
            {**query_filter, "barberId": None},
            sort=[("tokenNumber", 1)]
        )
    
    # DO NOT take customers assigned to another barber
    
    if next_entry and freed_chair:
        update_data = {
            "status": "serving",
            "chairNumber": freed_chair,
        }
        
        # Only set expiry time if timer is enabled (> 0)
        if waiting_timer > 0:
            expires_at = datetime.utcnow() + timedelta(minutes=waiting_timer)
            update_data["expiresAt"] = expires_at
        else:
            update_data["expiresAt"] = None  # Timer disabled
        
        if serving_barber_id:
            update_data["barberId"] = serving_barber_id
        
        await db.queue_entries.update_one(
            {"id": next_entry["id"]},
            {"$set": update_data}
        )

        try:
            await notify_customer_called(shop_id, {**next_entry, **update_data})
        except Exception as notify_exc:
            logger.warning(f"Failed to notify auto-started customer after skip {next_entry.get('id')}: {notify_exc}")

        auto_started = {
            "tokenNumber": next_entry["tokenNumber"],
            "name": next_entry["name"],
            "chairNumber": freed_chair,
            "barberId": serving_barber_id
        }
    
    return {
        "success": True,
        "skipped": {"tokenNumber": entry["tokenNumber"], "name": entry["name"]},
        "autoStarted": auto_started
    }


@api_router.post("/queue/{shop_id}/done/{entry_id}")
async def done_serving_shop(shop_id: str, entry_id: str, barber_id: str = None):
    """Mark customer as done and auto-call next for a specific shop/barber"""
    entry = await db.queue_entries.find_one({"id": entry_id, "status": "serving"})
    if not entry:
        raise HTTPException(status_code=404, detail="Serving entry not found")
    
    today = get_today_key()
    freed_chair = entry.get("chairNumber")
    serving_barber_id = entry.get("barberId") or barber_id
    
    # Mark as completed
    await db.queue_entries.update_one(
        {"id": entry_id},
        {"$set": {
            "status": "completed",
            "completedAt": datetime.utcnow(),
            "chairNumber": None
        }}
    )

    await disable_customer_entry_tokens(entry_id)
    
    # Get shop settings
    shop = await get_shop_by_id(shop_id)
    waiting_timer = shop.get("waitingTimer", 15) if shop else 15
    
    # Auto-start next customer for the same barber
    # STRICT RULE: Only pick from this barber's queue or general queue
    auto_started = None
    query_filter = {"dateKey": today, "status": "waiting"}
    if shop_id != "default":
        query_filter["shopId"] = shop_id
    
    # Find next customer: STRICTLY this barber's queue, then general queue only
    next_entry = None
    if serving_barber_id:
        # First look for customers assigned to this specific barber
        next_entry = await db.queue_entries.find_one(
            {**query_filter, "barberId": serving_barber_id},
            sort=[("tokenNumber", 1)]
        )
    
    if not next_entry:
        # Then look in general queue (barberId = null) - can go to any barber
        next_entry = await db.queue_entries.find_one(
            {**query_filter, "barberId": None},
            sort=[("tokenNumber", 1)]
        )
    
    # DO NOT take customers assigned to another barber
    
    if next_entry and freed_chair:
        update_data = {
            "status": "serving",
            "chairNumber": freed_chair,
        }
        
        # Only set expiry time if timer is enabled (> 0)
        if waiting_timer > 0:
            expires_at = datetime.utcnow() + timedelta(minutes=waiting_timer)
            update_data["expiresAt"] = expires_at
        else:
            update_data["expiresAt"] = None  # Timer disabled
        
        if serving_barber_id:
            update_data["barberId"] = serving_barber_id
        
        await db.queue_entries.update_one(
            {"id": next_entry["id"]},
            {"$set": update_data}
        )

        try:
            await notify_customer_called(shop_id, {**next_entry, **update_data})
        except Exception as notify_exc:
            logger.warning(f"Failed to notify auto-started customer after done {next_entry.get('id')}: {notify_exc}")

        auto_started = {
            "id": next_entry["id"],
            "tokenNumber": next_entry["tokenNumber"],
            "name": next_entry["name"],
            "chairNumber": freed_chair,
            "barberId": serving_barber_id
        }
        
        # Notify next-in-line (only from same barber's queue or general queue)
        # Find next waiting for this barber or in general queue
        next_in_line = None
        if serving_barber_id:
            next_in_line = await db.queue_entries.find_one(
                {**query_filter, "barberId": serving_barber_id, "id": {"$ne": next_entry["id"]}},
                sort=[("tokenNumber", 1)]
            )
        if not next_in_line:
            next_in_line = await db.queue_entries.find_one(
                {**query_filter, "barberId": None, "id": {"$ne": next_entry["id"]}},
                sort=[("tokenNumber", 1)]
            )
    
    return {
        "success": True,
        "completed": {"tokenNumber": entry["tokenNumber"], "name": entry["name"]},
        "autoStarted": auto_started
    }


@api_router.post("/queue/{shop_id}/expire/{entry_id}")
async def expire_customer(shop_id: str, entry_id: str):
    """Mark a customer as expired (timer ran out)"""
    entry = await db.queue_entries.find_one({"id": entry_id, "status": "serving"})
    if not entry:
        raise HTTPException(status_code=404, detail="Serving entry not found")
    
    await db.queue_entries.update_one(
        {"id": entry_id},
        {"$set": {
            "status": "expired",
            "chairNumber": None,
            "completedAt": datetime.utcnow()
        }}
    )

    try:
        await notify_customer_status(shop_id, entry, "expired")
    except Exception as notify_exc:
        logger.warning(f"Failed to notify expired customer {entry_id}: {notify_exc}")

    await disable_customer_entry_tokens(entry_id)
    
    return {
        "success": True,
        "message": f"Token #{entry['tokenNumber']} expired",
        "tokenNumber": entry["tokenNumber"]
    }


# ============================================================================
# SHOP-SPECIFIC ADMIN APIS (Stats, Reset, etc.)
# ============================================================================

@api_router.get("/admin/shop/{shop_id}/today-stats")
async def get_shop_today_stats(shop_id: str):
    """Get today's stats for a specific shop"""
    today = get_today_key()
    query = {"dateKey": today, "shopId": shop_id}
    
    total = await db.queue_entries.count_documents(query)
    completed = await db.queue_entries.count_documents({**query, "status": "completed"})
    serving = await db.queue_entries.count_documents({**query, "status": "serving"})
    waiting = await db.queue_entries.count_documents({**query, "status": "waiting"})
    left = await db.queue_entries.count_documents({**query, "status": "left"})
    skipped = await db.queue_entries.count_documents({**query, "status": {"$in": ["skipped", "expired"]}})
    
    return {
        "shopId": shop_id,
        "date": today,
        "total": total,
        "completed": completed,
        "serving": serving,
        "waiting": waiting,
        "left": left,
        "skipped": skipped
    }


@api_router.get("/admin/shop/{shop_id}/daily-stats")
async def get_shop_daily_stats(shop_id: str):
    """Get daily stats for the past 30 days for a specific shop"""
    from datetime import timedelta as td
    india_tz = pytz.timezone('Asia/Kolkata')
    today = datetime.now(india_tz).date()
    
    days = []
    for i in range(30):
        d = today - td(days=i)
        date_key = d.strftime('%Y-%m-%d')
        query = {"dateKey": date_key, "shopId": shop_id}
        
        total = await db.queue_entries.count_documents(query)
        if total > 0:
            completed = await db.queue_entries.count_documents({**query, "status": "completed"})
            days.append({
                "date": date_key,
                "total": total,
                "completed": completed
            })
    
    return {"shopId": shop_id, "days": days}


@api_router.get("/shop/{shop_id}/session-status")
async def get_shop_session_status(shop_id: str):
    """Get session reset status for a shop"""
    shop = await get_shop_by_id(shop_id)
    if shop:
        return {
            "sessionReset": shop.get("sessionResetAt") is not None,
            "sessionResetAt": shop.get("sessionResetAt")
        }
    return {"sessionReset": False, "sessionResetAt": None}


@api_router.post("/shop/{shop_id}/reset-session")
async def reset_shop_session(shop_id: str):
    """Reset barber session for a specific shop (logs out all barbers)"""
    result = await db.shops.update_one(
        {"shopId": shop_id},
        {"$set": {"sessionResetAt": datetime.utcnow(), "updatedAt": datetime.utcnow()}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Shop not found")
    return {"success": True, "message": f"Session reset for shop {shop_id}"}


@api_router.post("/queue/{shop_id}/reset-day")
async def reset_shop_day(shop_id: str):
    """Reset/clear all queue entries for today for a specific shop"""
    today = get_today_key()
    result = await db.queue_entries.delete_many({"dateKey": today, "shopId": shop_id})
    return {
        "success": True,
        "message": f"Cleared {result.deleted_count} entries for shop {shop_id}",
        "deletedCount": result.deleted_count
    }


@api_router.post("/queue/{shop_id}/remove-token")
async def remove_shop_token(shop_id: str, data: dict):
    """Remove a specific token from a shop's queue"""
    today = get_today_key()
    token_num = data.get("tokenNumber")
    if not token_num:
        raise HTTPException(status_code=400, detail="Token number required")
    
    result = await db.queue_entries.delete_one({
        "dateKey": today,
        "shopId": shop_id,
        "tokenNumber": token_num
    })
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail=f"Token #{token_num} not found")
    
    return {"success": True, "message": f"Token #{token_num} removed"}


# ============================================================================
# NOTIFICATION APIs (Expo Push)
# ============================================================================

@api_router.post("/notifications/register-device")
async def register_notification_device(payload: RegisterDeviceRequest):
    logger.info(f"[REGISTER] Incoming: userType={payload.userType}, shopId={payload.shopId}, entryId={payload.entryId}, tokenPrefix={payload.token[:20] if payload.token else 'None'}...")
    token = payload.token.strip()
    if not is_valid_fcm_token(token):
        logger.warning(f"[REGISTER] Invalid FCM token rejected")
        raise HTTPException(status_code=400, detail="Invalid FCM token")

    user_type = (payload.userType or "").strip().lower()
    if user_type not in {"barber", "customer"}:
        raise HTTPException(status_code=400, detail="userType must be barber or customer")

    if user_type == "customer" and not payload.entryId:
        logger.warning(f"[REGISTER] Customer registration missing entryId")
        raise HTTPException(status_code=400, detail="entryId is required for customer registration")

    logger.info(f"[REGISTER] Upserting device_tokens: userType={user_type}, shopId={payload.shopId}, entryId={payload.entryId if user_type == 'customer' else None}")

    now = datetime.utcnow()
    filter_query = {
        "token": token,
        "userType": user_type,
        "entryId": payload.entryId if user_type == "customer" else None,
    }

    await db.device_tokens.update_one(
        filter_query,
        {
            "$set": {
                "token": token,
                "platform": payload.platform,
                "userType": user_type,
                "shopId": payload.shopId,
                "barberId": payload.barberId,
                "entryId": payload.entryId if user_type == "customer" else None,
                "enabled": payload.enabled,
                "lastSeenAt": now,
                "updatedAt": now,
            },
            "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "createdAt": now,
            }
        },
        upsert=True
    )

    return {
        "success": True,
        "token": token,
        "userType": user_type,
        "shopId": payload.shopId,
        "entryId": payload.entryId if user_type == "customer" else None,
    }


@api_router.delete("/notifications/unregister-device")
async def unregister_notification_device(payload: UnregisterDeviceRequest):
    token = payload.token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Token is required")

    filter_query: Dict[str, Any] = {"token": token}
    if payload.userType:
        filter_query["userType"] = payload.userType.strip().lower()
    if payload.entryId:
        filter_query["entryId"] = payload.entryId

    result = await db.device_tokens.update_many(
        filter_query,
        {"$set": {"enabled": False, "updatedAt": datetime.utcnow()}}
    )

    return {"success": True, "disabledCount": result.modified_count}


@api_router.get("/notifications/debug-tokens")
async def debug_device_tokens(shop_id: str = None):
    """Debug: list all registered device tokens"""
    query = {}
    if shop_id:
        query["shopId"] = shop_id
    docs = await db.device_tokens.find(query).to_list(100)
    tokens = []
    for doc in docs:
        if '_id' in doc:
            del doc['_id']
        # Mask token for safety
        if doc.get("token"):
            t = doc["token"]
            doc["token"] = f"{t[:15]}...{t[-8:]}" if len(t) > 25 else t
        tokens.append(doc)
    return {"count": len(tokens), "tokens": tokens}


@api_router.post("/notifications/test")
async def send_test_notification(payload: NotificationTestRequest):
    if payload.token:
        tokens = [payload.token]
    else:
        query: Dict[str, Any] = {}
        if payload.userType:
            query["userType"] = payload.userType.strip().lower()
        if payload.shopId:
            query["shopId"] = payload.shopId
        tokens = await get_enabled_tokens(query)

    if not tokens:
        return {"success": False, "message": "No target devices found", "targetCount": 0}

    messages = [{
        "to": token,
        "title": payload.title,
        "body": payload.body,
        "data": payload.data,
    } for token in tokens]

    try:
        result = await send_fcm_notifications(messages)
    except Exception as e:
        logger.error(f"Test notification send error: {e}")
        return {"success": False, "targetCount": len(tokens), "error": str(e)}
    return {
        "success": True,
        "targetCount": len(tokens),
        **result,
    }


# ============================================================================
# QUEUE APIS (Updated for Multi-Shop)
# ============================================================================

@api_router.post("/queue/join")
async def join_queue(request: JoinQueueRequest):
    shop_id = request.shopId or "default"
    logger.info(f"[JOIN] === Queue join request: name={request.name}, shopId={shop_id}, barberId={request.barberId}, addedBy={request.addedBy} ===")

    # Check if shop is open
    if not await is_shop_open(shop_id):
        logger.info(f"[JOIN] Shop {shop_id} is closed, rejecting join")
        raise HTTPException(status_code=403, detail="Shop is currently closed")

    today = get_today_key()

    # Get next token for this specific shop
    max_entry = await db.queue_entries.find_one(
        {"dateKey": today, "shopId": shop_id},
        sort=[("tokenNumber", -1)]
    )
    next_token = 1 if not max_entry else max_entry["tokenNumber"] + 1

    entry = QueueEntry(
        shopId=shop_id,
        dateKey=today,
        tokenNumber=next_token,
        name=request.name,
        phone=request.phone,
        status="waiting",
        addedBy=request.addedBy or "customer",
        barberId=request.barberId
    )
    await db.queue_entries.insert_one(entry.dict())

    try:
        logger.info(f"[JOIN] Sending barber notification for shop={shop_id}, token=#{entry.tokenNumber}")
        await notify_barbers_for_join(
            shop_id=shop_id,
            entry_id=entry.id,
            token_number=entry.tokenNumber,
            customer_name=entry.name,
            barber_id=request.barberId,
        )
        logger.info(f"[JOIN] Barber notification completed for token=#{entry.tokenNumber}")
    except Exception as notify_exc:
        logger.error(f"[JOIN] FAILED to notify barbers for shop {shop_id}: {notify_exc}", exc_info=True)

    # People ahead = only waiting tokens before this user in same shop
    people_ahead = await db.queue_entries.count_documents({
        "dateKey": today,
        "shopId": shop_id,
        "tokenNumber": {"$lt": next_token},
        "status": "waiting"
    })

    # Serving now in same shop
    serving_entries = await db.queue_entries.find(
        {"dateKey": today, "shopId": shop_id, "status": "serving"}
    ).sort("tokenNumber", 1).to_list(100)
    serving_now = [e["tokenNumber"] for e in serving_entries]
    currently_serving = len(serving_now)

    return {
        "id": entry.id,
        "tokenNumber": entry.tokenNumber,
        "name": entry.name,
        "status": entry.status,
        "shopId": shop_id,
        "servingNow": serving_now,
        "peopleAhead": max(0, people_ahead),
        "currentlyServing": currently_serving,
        "createdAt": entry.createdAt.isoformat()
    }


@api_router.get("/queue/status/{entry_id}")
async def get_status(entry_id: str):
    entry = await db.queue_entries.find_one({"id": entry_id})
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    # Serving now
    serving_entries = await db.queue_entries.find(
        {"dateKey": entry["dateKey"], "status": "serving"}
    ).sort("tokenNumber", 1).to_list(100)
    serving_now = [e["tokenNumber"] for e in serving_entries]

    # People ahead - only count waiting tokens before user
    if entry["status"] == "serving":
        people_ahead = 0
    elif entry["status"] == "waiting":
        people_ahead = await db.queue_entries.count_documents({
            "dateKey": entry["dateKey"],
            "tokenNumber": {"$lt": entry["tokenNumber"]},
            "status": "waiting"
        })
    else:
        people_ahead = 0

    currently_serving = len(serving_now)

    created_at = entry["createdAt"]
    if isinstance(created_at, datetime):
        created_at = created_at.isoformat()

    # Format expiresAt and serviceStartedAt
    expires_at = entry.get("expiresAt")
    if isinstance(expires_at, datetime):
        expires_at = expires_at.isoformat()
    
    service_started_at = entry.get("serviceStartedAt")
    if isinstance(service_started_at, datetime):
        service_started_at = service_started_at.isoformat()

    return {
        "id": entry["id"],
        "tokenNumber": entry["tokenNumber"],
        "name": entry["name"],
        "status": entry["status"],
        "servingNow": serving_now,
        "peopleAhead": max(0, people_ahead),
        "currentlyServing": currently_serving,
        "createdAt": created_at,
        "expiresAt": expires_at,
        "serviceStartedAt": service_started_at
    }


@api_router.get("/queue/current")
async def get_current_queue(shop: str = None):
    """Get current queue status. Supports optional shop parameter for multi-shop."""
    today = get_today_key()
    shop_id = shop or "default"
    
    # Build query filter
    query_filter = {"dateKey": today}
    if shop_id != "default":
        query_filter["shopId"] = shop_id
    
    waiting_count = await db.queue_entries.count_documents({
        **query_filter, "status": "waiting"
    })
    serving_entries = await db.queue_entries.find(
        {**query_filter, "status": "serving"}
    ).sort("tokenNumber", 1).to_list(100)
    serving_now = [e["tokenNumber"] for e in serving_entries]

    return {
        "waitingCount": waiting_count,
        "servingNow": serving_now,
        "shopId": shop_id
    }


@api_router.post("/queue/start-next")
async def start_next():
    """Move earliest waiting customer to serving with fixed chair assignment"""
    today = get_today_key()
    settings = await get_shop_settings()
    active_barbers = settings.get("activeBarbers", 1)

    # Get occupied chair numbers
    serving_entries = await db.queue_entries.find(
        {"dateKey": today, "status": "serving"}
    ).to_list(100)
    occupied_chairs = {e.get("chairNumber") for e in serving_entries if e.get("chairNumber")}

    if len(serving_entries) >= active_barbers:
        raise HTTPException(status_code=400, detail="All chairs are occupied")

    # Find first available chair number
    available_chair = None
    for c in range(1, active_barbers + 1):
        if c not in occupied_chairs:
            available_chair = c
            break
    if available_chair is None:
        available_chair = len(serving_entries) + 1

    next_entry = await db.queue_entries.find_one(
        {"dateKey": today, "status": "waiting"},
        sort=[("tokenNumber", 1)]
    )
    if not next_entry:
        raise HTTPException(status_code=404, detail="No waiting customers")

    await db.queue_entries.update_one(
        {"id": next_entry["id"]},
        {"$set": {"status": "serving", "chairNumber": available_chair}}
    )

    try:
        notify_shop_id = next_entry.get("shopId", "default")
        await notify_customer_called(notify_shop_id, {**next_entry, "chairNumber": available_chair, "status": "serving"})
    except Exception as notify_exc:
        logger.warning(f"Failed to notify legacy start-next customer {next_entry.get('id')}: {notify_exc}")

    return {
        "success": True,
        "message": f"Token #{next_entry['tokenNumber']} ({next_entry['name']}) → Chair {available_chair}",
        "tokenNumber": next_entry["tokenNumber"],
        "name": next_entry["name"],
        "chairNumber": available_chair
    }


@api_router.post("/queue/done/{entry_id}")
async def done_serving(entry_id: str):
    """Mark a specific serving customer as completed and auto-start next in same chair"""
    entry = await db.queue_entries.find_one({"id": entry_id, "status": "serving"})
    if not entry:
        raise HTTPException(status_code=404, detail="Serving entry not found")

    today = get_today_key()
    freed_chair = entry.get("chairNumber")

    # Mark as completed, clear chair
    await db.queue_entries.update_one(
        {"id": entry_id},
        {"$set": {"status": "completed", "completedAt": datetime.utcnow(), "chairNumber": None}}
    )

    await disable_customer_entry_tokens(entry_id)

    # Auto-start next in the SAME chair that was freed
    auto_started = None
    next_entry = await db.queue_entries.find_one(
        {"dateKey": today, "status": "waiting"},
        sort=[("tokenNumber", 1)]
    )
    if next_entry and freed_chair:
        await db.queue_entries.update_one(
            {"id": next_entry["id"]},
            {"$set": {"status": "serving", "chairNumber": freed_chair}}
        )

        try:
            notify_shop_id = next_entry.get("shopId", "default")
            await notify_customer_called(notify_shop_id, {**next_entry, "chairNumber": freed_chair, "status": "serving"})
        except Exception as notify_exc:
            logger.warning(f"Failed to notify legacy auto-start customer {next_entry.get('id')}: {notify_exc}")

        auto_started = {
            "id": next_entry["id"],
            "tokenNumber": next_entry["tokenNumber"],
            "name": next_entry["name"],
            "chairNumber": freed_chair
        }

    return {
        "success": True,
        "completed": {"tokenNumber": entry["tokenNumber"], "name": entry["name"]},
        "autoStarted": auto_started
    }


@api_router.patch("/queue/complete")
async def complete_current():
    """Legacy: complete the first serving/waiting customer"""
    today = get_today_key()
    current = await db.queue_entries.find_one(
        {"dateKey": today, "status": "serving"},
        sort=[("tokenNumber", 1)]
    )
    if not current:
        current = await db.queue_entries.find_one(
            {"dateKey": today, "status": "waiting"},
            sort=[("tokenNumber", 1)]
        )
    if not current:
        raise HTTPException(status_code=404, detail="No entries found")
    await db.queue_entries.update_one(
        {"id": current["id"]},
        {"$set": {"status": "completed", "completedAt": datetime.utcnow()}}
    )
    return {"success": True, "message": f"Token #{current['tokenNumber']} completed"}


@api_router.patch("/queue/{entry_id}/leave")
async def leave_queue(entry_id: str):
    result = await db.queue_entries.update_one(
        {"id": entry_id, "status": {"$in": ["waiting", "serving"]}},
        {"$set": {"status": "left"}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Entry not found")

    await disable_customer_entry_tokens(entry_id)
    return {"success": True, "message": "Left queue successfully"}


@api_router.post("/queue/reset-day")
async def reset_day():
    today = get_today_key()
    result = await db.queue_entries.delete_many({"dateKey": today})
    return {"success": True, "message": f"Reset {result.deleted_count} entries"}


@api_router.get("/queue/dashboard")
async def get_dashboard():
    today = get_today_key()
    settings = await get_shop_settings()
    active_barbers = settings.get("activeBarbers", 1)

    waiting_count = await db.queue_entries.count_documents({"dateKey": today, "status": "waiting"})
    serving_count = await db.queue_entries.count_documents({"dateKey": today, "status": "serving"})
    completed_count = await db.queue_entries.count_documents({"dateKey": today, "status": "completed"})

    serving_entries = await db.queue_entries.find(
        {"dateKey": today, "status": "serving"}
    ).sort("tokenNumber", 1).to_list(100)

    waiting_entries = await db.queue_entries.find(
        {"dateKey": today, "status": "waiting"}
    ).sort("tokenNumber", 1).to_list(1000)

    completed_entries = await db.queue_entries.find(
        {"dateKey": today, "status": "completed"}
    ).sort("completedAt", -1).to_list(1000)

    def fmt_dt(val):
        if isinstance(val, datetime):
            return val.isoformat()
        return str(val) if val else ""

    serving_list = [{
        "id": e["id"], "tokenNumber": e["tokenNumber"],
        "name": e["name"], "chairNumber": e.get("chairNumber"),
        "createdAt": fmt_dt(e["createdAt"])
    } for e in serving_entries]

    waiting_list = [{
        "id": e["id"], "tokenNumber": e["tokenNumber"],
        "name": e["name"], "createdAt": fmt_dt(e["createdAt"])
    } for e in waiting_entries]

    completed_list = [{
        "id": e["id"], "tokenNumber": e["tokenNumber"],
        "name": e["name"], "completedAt": fmt_dt(e.get("completedAt"))
    } for e in completed_entries]

    return {
        "activeBarbers": active_barbers,
        "servingCount": serving_count,
        "waitingCount": waiting_count,
        "completedCount": completed_count,
        "servingList": serving_list,
        "waitingList": waiting_list,
        "completedList": completed_list
    }


@api_router.get("/queue/next-serving")
async def get_next_serving():
    today = get_today_key()
    next_entry = await db.queue_entries.find_one(
        {"dateKey": today, "status": "waiting"},
        sort=[("tokenNumber", 1)]
    )
    if not next_entry:
        raise HTTPException(status_code=404, detail="No waiting entries")
    return {"tokenNumber": next_entry["tokenNumber"], "name": next_entry["name"]}


@api_router.get("/admin/today-stats")
async def get_today_stats():
    today = get_today_key()

    total = await db.queue_entries.count_documents({"dateKey": today})
    completed = await db.queue_entries.count_documents({"dateKey": today, "status": "completed"})
    serving = await db.queue_entries.count_documents({"dateKey": today, "status": "serving"})
    waiting = await db.queue_entries.count_documents({"dateKey": today, "status": "waiting"})
    left = await db.queue_entries.count_documents({"dateKey": today, "status": "left"})

    # Barber-added counts
    barber_added = await db.queue_entries.count_documents({"dateKey": today, "addedBy": "barber"})
    self_joined = total - barber_added

    completed_entries = await db.queue_entries.find(
        {"dateKey": today, "status": "completed"}
    ).sort("completedAt", -1).to_list(1000)

    barber_added_entries = await db.queue_entries.find(
        {"dateKey": today, "addedBy": "barber"}
    ).sort("tokenNumber", 1).to_list(1000)

    def fmt_dt(val):
        if isinstance(val, datetime):
            return val.isoformat()
        return str(val) if val else ""

    completed_list = [{
        "tokenNumber": e["tokenNumber"],
        "name": e["name"],
        "addedBy": e.get("addedBy", "customer"),
        "completedAt": fmt_dt(e.get("completedAt"))
    } for e in completed_entries]

    barber_added_list = [{
        "tokenNumber": e["tokenNumber"],
        "name": e["name"],
        "status": e["status"]
    } for e in barber_added_entries]

    return {
        "dateKey": today,
        "total": total,
        "completed": completed,
        "serving": serving,
        "waiting": waiting,
        "left": left,
        "barberAdded": barber_added,
        "selfJoined": self_joined,
        "completedList": completed_list,
        "barberAddedList": barber_added_list
    }


@api_router.get("/admin/monthly-stats")
async def get_monthly_stats(month: str = None):
    """Get daily customer counts for a month. month format: YYYY-MM"""
    if not month:
        india_now = datetime.now(INDIA_TZ)
        month = india_now.strftime("%Y-%m")

    # Get all entries for this month using dateKey prefix match
    pipeline = [
        {"$match": {"dateKey": {"$regex": f"^{month}"}}},
        {"$group": {
            "_id": "$dateKey",
            "total": {"$sum": 1},
            "completed": {"$sum": {"$cond": [{"$eq": ["$status", "completed"]}, 1, 0]}},
            "left": {"$sum": {"$cond": [{"$eq": ["$status", "left"]}, 1, 0]}},
            "barberAdded": {"$sum": {"$cond": [{"$eq": ["$addedBy", "barber"]}, 1, 0]}},
        }},
        {"$sort": {"_id": -1}}
    ]

    results = await db.queue_entries.aggregate(pipeline).to_list(31)

    days = [{
        "date": r["_id"],
        "total": r["total"],
        "completed": r["completed"],
        "left": r["left"],
        "barberAdded": r.get("barberAdded", 0)
    } for r in results]

    # Calculate month total
    month_total = sum(d["total"] for d in days)
    month_completed = sum(d["completed"] for d in days)

    return {
        "month": month,
        "monthTotal": month_total,
        "monthCompleted": month_completed,
        "days": days
    }


# Include router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')


@app.on_event("startup")
async def startup_migration():
    """Run migrations on startup"""
    await db.device_tokens.create_index(
        [("token", ASCENDING), ("userType", ASCENDING), ("entryId", ASCENDING)],
        unique=True,
        name="token_user_entry_unique"
    )
    await db.device_tokens.create_index(
        [("enabled", ASCENDING), ("userType", ASCENDING), ("shopId", ASCENDING), ("barberId", ASCENDING)],
        name="device_tokens_lookup"
    )

    # Clear closedDays for all existing shops (fix Tuesday closure issue)
    await db.shops.update_many(
        {"closedDays": {"$exists": True, "$ne": []}},
        {"$set": {"closedDays": []}}
    )
    # Update shops with 21:00 close time to 22:00 (extend hours)
    await db.shops.update_many(
        {"closeTime": "21:00"},
        {"$set": {"closeTime": "22:00"}}
    )
    logger.info("Migration completed: indexes ready, closedDays cleared, and close time updated")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


# Serve static files
STATIC_DIR = ROOT_DIR / "static"


@app.get("/")
async def serve_index():
    return FileResponse(str(STATIC_DIR / "index.html"))


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
