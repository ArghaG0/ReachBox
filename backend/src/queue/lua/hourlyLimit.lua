-- Dynamic keys are not Redis Cluster safe; this service supports a single Redis instance.
local senderId = ARGV[1]
local limit = tonumber(ARGV[2])
local windowMs = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local prefix = ARGV[5]
local now = tonumber(ARGV[6])
if not now then
  local time = redis.call('TIME')
  now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
end
if not limit or limit < 1 then
  return redis.error_reply('limit must be positive')
end
local windowStart = math.floor(now / windowMs) * windowMs
local key = prefix .. ':' .. senderId .. ':' .. string.format('%.0f', windowStart)
local count = redis.call('INCR', key)
if count == 1 then
  redis.call('EXPIRE', key, ttl)
end
return {count, windowStart}
