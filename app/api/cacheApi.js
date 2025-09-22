import global from "../global.js";
import config from "../config.js";
import redisCache from "../redisCache.js";
import md5 from "md5";
import utils from "../utils.js";

global.cacheStats = {};
// this value should be incremented whenever data format changes, to avoid
// pulling old-format data from a persistent cache
const cacheKeyVersion = "v1";
let redisCacheObj = null

const ONE_SEC = 1000;
const ONE_MIN = 60 * ONE_SEC;
const ONE_HR = 60 * ONE_MIN;
const FIVE_MINUTES = 5 * ONE_MIN;
const ONE_DAY = 24 * ONE_HR;
const ONE_YR = 265 * ONE_DAY;

if (redisCache.active) {
	global.cacheStats.redis = {
		try: 0,
		hit: 0,
		miss: 0,
		error: 0
	};

	var onRedisCacheEvent = function(cacheType, eventType, cacheKey) {
		if(!('redis' in global.cacheStats)) {
			global.cacheStats.redis = {
				try: 0,
				hit: 0,
				miss: 0
			};
		}
		global.cacheStats.redis[eventType]++;
	}

	// md5 of the active RPC credentials serves as part of the key; this enables
	// multiple instances of btc-rpc-explorer (eg mainnet + testnet) to share
	// a single redis instance peacefully
	const rpcCredKeyComponent = md5(JSON.stringify(config.credentials.rpc)).substring(0, 8);
	redisCacheObj = redisCache.createCache(`${cacheKeyVersion}-${rpcCredKeyComponent}`, onRedisCacheEvent);
}  else {
	console.log('The Exana Explorer must have a redis cache setup to work');
	setTimeout(process.exit(0), 3000);
}

async function tryCacheThenCallFunction(cacheKey, cacheMaxAge, functionToCall, cacheConditionFunction) {
	if (cacheConditionFunction == null) {
		cacheConditionFunction = function(obj) {
			return true;
		};

		try {
			const cacheResult = await redisCacheObj.get(cacheKey);
			if (cacheResult != null) {
				return cacheResult;
			}

			const functionResult = await functionToCall();

			if (functionResult != null && cacheConditionFunction(functionResult)) {
				redisCacheObj.set(cacheKey, functionResult, cacheMaxAge);
			}

			return functionResult;
		} catch (err) {
			throw err;
		}
	}
}

function tryCacheThenRpcApi(cacheKey, cacheMaxAge, rpcApiFunction, cacheConditionFunction) {

	if (cacheConditionFunction == null) {
		cacheConditionFunction = function(obj) {
			return true;
		};
	}

	return new Promise(function(resolve, reject) {
		var cacheResult = null;

		var finallyFunc = function() {
			if (cacheResult != null) {
				resolve(cacheResult);

			} else {
				rpcApiFunction().then(function(rpcResult) {
					if (rpcResult != null && cacheConditionFunction(rpcResult)) {
						redisCacheObj.set(cacheKey, rpcResult, cacheMaxAge);
					}

					resolve(rpcResult);

				}).catch(function(err) {
					reject(err);
				});
			}
		};

		redisCacheObj.get(cacheKey).then(function(result) {
			cacheResult = result;

			finallyFunc();

		}).catch(function(err) {
			utils.logError("nds9fc2eg621tf3", err, {cacheKey:cacheKey});

			finallyFunc();
		});
	});
}

export default {
	ONE_SEC,
	ONE_MIN,
	ONE_HR,
	FIVE_MINUTES,
	ONE_DAY,
	ONE_YR,
	redisCacheObj,
	tryCacheThenCallFunction,
	tryCacheThenRpcApi,
}
