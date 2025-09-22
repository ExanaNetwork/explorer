import debug from "debug";
import Decimal from "decimal.js";
import axios from "axios";
import qrcode from "qrcode";
import textdecoding from "text-decoding";
import fs from "fs";
import path from "path";

import config from "./config.js";
import coins from "./coins.js";
import global from "./global.js";
import JSZip from "jszip";
import coreApi from './api/coreApi.js';
import tokenProcessQueue from './tokenProcessQueue.js';
import db from '../models/index.js'
import {Address, AddressType, GroupIdType, GroupToken, Script} from "libexana-ts";
var Op = db.Sequelize.Op;

const debugLog = debug("nexexp:utils");
const debugErrorLog = debug("nexexp:error");
const debugErrorVerboseLog = debug("nexexp:errorVerbose");
const debugPerfLog = debug("nexexp:actionPerformace");

const coinConfig = coins[config.coin];

function perfMeasure(req) {
	var time = Date.now() - req.startTime;
	var memdiff = process.memoryUsage().heapUsed - req.startMem;

	debugPerfLog("Finished action '%s' in %d ms", req.path, time);
}

function redirectToConnectPageIfNeeded(req, res) {
	if (!req.session.host) {
		req.session.redirectUrl = req.originalUrl;

		res.redirect("/");
		res.end();

		return true;
	}

	return false;
}

function hex2ascii(hex) {
	var str = "";
	for (var i = 0; i < hex.length; i += 2) {
		str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
	}

	return str;
}

function hex2array(hex) {
	return new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
}

function hex2string(hex, encoding = 'utf-8') {
	return new textdecoding.TextDecoder(encoding).decode(hex2array(hex))
}

function uint8Array2hexstring(byteArray) {
	return Array.from(byteArray)
		.map(b => b.toString(16).padStart(2, '0'))
		.join('');
}

function splitArrayIntoChunks(array, chunkSize) {
	var j = array.length;
	var chunks = [];

	for (var i = 0; i < j; i += chunkSize) {
		chunks.push(array.slice(i, i + chunkSize));
	}

	return chunks;
}

function splitArrayIntoChunksByChunkCount(array, chunkCount) {
	var bigChunkSize = Math.ceil(array.length / chunkCount);
	var bigChunkCount = chunkCount - (chunkCount * bigChunkSize - array.length);

	var chunks = [];

	var chunkStart = 0;
	for (var chunk = 0; chunk < chunkCount; chunk++) {
		var chunkSize = (chunk < bigChunkCount ? bigChunkSize : (bigChunkSize - 1));

		chunks.push(array.slice(chunkStart, chunkStart + chunkSize));

		chunkStart += chunkSize;
	}

	return chunks;
}

function getRandomString(length, chars) {
	var mask = '';

	if (chars.indexOf('a') > -1) {
		mask += 'abcdefghijklmnopqrstuvwxyz';
	}

	if (chars.indexOf('A') > -1) {
		mask += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
	}

	if (chars.indexOf('#') > -1) {
		mask += '0123456789';
	}

	if (chars.indexOf('!') > -1) {
		mask += '~`!@#$%^&*()_+-={}[]:";\'<>?,./|\\';
	}

	var result = '';
	for (var i = length; i > 0; --i) {
		result += mask[Math.floor(Math.random() * mask.length)];
	}

	return result;
}

var formatCurrencyCache = {};

function getCurrencyFormatInfo(formatType) {
	if (formatCurrencyCache[formatType] == null) {
		for (var x = 0; x < coins[config.coin].currencyUnits.length; x++) {
			var currencyUnit = coins[config.coin].currencyUnits[x];

			for (var y = 0; y < currencyUnit.values.length; y++) {
				var currencyUnitValue = currencyUnit.values[y];

				if (currencyUnitValue == formatType) {
					formatCurrencyCache[formatType] = currencyUnit;
				}
			}
		}
	}

	return formatCurrencyCache[formatType];
}

function formatCurrencyAmountWithForcedDecimalPlaces(amount, formatType, forcedDecimalPlaces) {
	var formatInfo = getCurrencyFormatInfo(formatType);
	if (formatInfo != null) {
		var dec = new Decimal(amount);

		var decimalPlaces = formatInfo.decimalPlaces;

		if (forcedDecimalPlaces >= 0) {
			decimalPlaces = forcedDecimalPlaces;
		}

		if (formatInfo.type == "native") {
			dec = dec.times(formatInfo.multiplier);

			if (forcedDecimalPlaces >= 0) {
				// toFixed will keep trailing zeroes
				var baseStr = addThousandsSeparators(dec.toFixed(decimalPlaces));

				return {val:baseStr, currencyUnit:formatInfo.name, simpleVal:baseStr};

			} else {
				// toDP will strip trailing zeroes
				var baseStr = addThousandsSeparators(dec.toDP(decimalPlaces));

				var returnVal = {currencyUnit:formatInfo.name, simpleVal:baseStr};

				// max digits in "val"
				var maxValDigits = config.site.valueDisplayMaxLargeDigits;

				if (baseStr.indexOf(".") == -1) {
					returnVal.val = baseStr;

				} else {
					if (baseStr.length - baseStr.indexOf(".") - 1 > maxValDigits) {
						returnVal.val = baseStr.substring(0, baseStr.indexOf(".") + maxValDigits + 1);
						returnVal.lessSignificantDigits = baseStr.substring(baseStr.indexOf(".") + maxValDigits + 1);

					} else {
						returnVal.val = baseStr;
					}
				}

				return returnVal;
			}

		} else if (formatInfo.type == "exchanged") {
			if (global.exchangeRates != null && global.exchangeRates[formatInfo.multiplier] != null) {
				dec = dec.times(global.exchangeRates[formatInfo.multiplier]);

				var baseStr = addThousandsSeparators(dec.toDecimalPlaces(decimalPlaces));

				return {val:baseStr, currencyUnit:formatInfo.name, simpleVal:baseStr};
			} else {
				return formatCurrencyAmountWithForcedDecimalPlaces(amount, coinConfig.defaultCurrencyUnit.name, forcedDecimalPlaces);
			}
		}
	}

	return amount;
}

function formatCurrencyAmount(amount, formatType) {
	return formatCurrencyAmountWithForcedDecimalPlaces(amount, formatType, -1);
}

function formatCurrencyAmountInSmallestUnits(amount, forcedDecimalPlaces) {
	return formatCurrencyAmountWithForcedDecimalPlaces(amount, coins[config.coin].baseCurrencyUnit.name, forcedDecimalPlaces);
}

// ref: https://stackoverflow.com/a/2901298/673828
function addThousandsSeparators(x) {
	var parts = x.toString().split(".");
	parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");

	return parts.join(".");
}

function padSatoshiValues (quantity, decimalPlaces) {
	let satoshis = String(quantity).padStart(decimalPlaces, '0');
	let integerPart = satoshis.slice(0, - decimalPlaces);
	let fractionalPart = satoshis.slice(- decimalPlaces);
	return integerPart + "." + fractionalPart;
}

function formatValueInActiveCurrency(amount) {
	if (global.currencyFormatType && global.exchangeRates[global.currencyFormatType.toLowerCase()]) {
		return formatExchangedCurrency(amount, global.currencyFormatType);

	} else {
		return formatExchangedCurrency(amount, "usdt");
	}
}

function satoshisPerUnitOfActiveCurrency() {
	if (global.currencyFormatType != null && global.exchangeRates != null) {
		var exchangeType = global.currencyFormatType.toLowerCase();

		if (!global.exchangeRates[global.currencyFormatType.toLowerCase()]) {
			// if current display currency is a native unit, default to USD for exchange values
			exchangeType = "usdt";
		}

		var dec = new Decimal(1);
		var one = new Decimal(1);
		dec = dec.times(global.exchangeRates[exchangeType]);

		// USDT/EXANA -> EXANA/USDT
		dec = one.dividedBy(dec);

		var unitName = coins[config.coin].baseCurrencyUnit.name;
		var formatInfo = getCurrencyFormatInfo(unitName);

		// BTC/USD -> sat/USD
		dec = dec.times(formatInfo.multiplier);

		var exchangedAmt = parseInt(dec);

		if (exchangeType == "eur") {
			return {amt:addThousandsSeparators(exchangedAmt), unit:`${unitName}/€`};
		} else {
			return {amt:addThousandsSeparators(exchangedAmt), unit:`${unitName}/$`};
		}

	}

	return null;
}

function formatExchangedCurrency(amount, exchangeType) {
	if (global.exchangeRates != null && global.exchangeRates[exchangeType.toLowerCase()] != null) {
		var dec = new Decimal(amount);
		dec = dec.times(global.exchangeRates[exchangeType.toLowerCase()]);
		var precision = coinConfig.currencyUnitsByName[exchangeType.toUpperCase()].decimalPlaces;
		var exchangedAmt = parseFloat(Math.round(dec*(10**precision))/10**precision);

		if (exchangeType == "eur") {
			return "€" + addThousandsSeparators(exchangedAmt);

		} else {
			return "$" + addThousandsSeparators(exchangedAmt);
		}

	}

	return "";
}

function seededRandom(seed) {
	var x = Math.sin(seed++) * 10000;
	return x - Math.floor(x);
}

function seededRandomIntBetween(seed, min, max) {
	var rand = seededRandom(seed);
	return (min + (max - min) * rand);
}

function ellipsize(str, length, ending="…") {
	if (str.length <= length) {
		return str;

	} else {
		return str.substring(0, length - ending.length) + ending;
	}
}

function shortenTimeDiff(str) {
	str = str.replace(" years", "y");
	str = str.replace(" year", "y");

	str = str.replace(" months", "mo");
	str = str.replace(" month", "mo");

	str = str.replace(" weeks", "w");
	str = str.replace(" week", "w");

	str = str.replace(" days", "d");
	str = str.replace(" day", "d");

	str = str.replace(" hours", "hr");
	str = str.replace(" hour", "hr");

	str = str.replace(" minutes", "min");
	str = str.replace(" minute", "min");

	return str;
}

function logMemoryUsage() {
	var mbUsed = process.memoryUsage().heapUsed / 1024 / 1024;
	mbUsed = Math.round(mbUsed * 100) / 100;

	var mbTotal = process.memoryUsage().heapTotal / 1024 / 1024;
	mbTotal = Math.round(mbTotal * 100) / 100;

	//debugLog("memoryUsage: heapUsed=" + mbUsed + ", heapTotal=" + mbTotal + ", ratio=" + parseInt(mbUsed / mbTotal * 100));
}

var possibleMinerSignalRE = /\/(.*)\//;

function getMinerCustomData(tx) {
	if (tx == null || tx.vin.length >=1 ) {
		return null;
	}
	var customData = tx.vout[tx.vout.length - 1].scriptPubKey.asm.split(" ").splice(2).join(" ");
	return customData
}

function getMinerFromCoinbaseTx(tx) {
	if (tx == null || tx.vin.length >=1 ) {
		return null;
	}

	var minerInfo = {
		coinbaseStr: hex2string(getMinerCustomData(tx))
	};

	var possibleSignal = minerInfo.coinbaseStr.match(possibleMinerSignalRE);
	if (possibleSignal)
		minerInfo.possibleSignal = possibleSignal[1];

	if (global.miningPoolsConfigs) {
		poolLoop:
		for (var i = 0; i < global.miningPoolsConfigs.length; i++) {
			var miningPoolsConfig = global.miningPoolsConfigs[i];

			for (var payoutAddress in miningPoolsConfig.payout_addresses) {
				if (miningPoolsConfig.payout_addresses.hasOwnProperty(payoutAddress)) {
					if (tx.vout && tx.vout.length > 0 && tx.vout[0].scriptPubKey && tx.vout[0].scriptPubKey.addresses && tx.vout[0].scriptPubKey.addresses.length > 0) {
						if (tx.vout[0].scriptPubKey.addresses[0] == payoutAddress) {
							Object.assign(minerInfo, miningPoolsConfig.payout_addresses[payoutAddress]);
							minerInfo.identifiedBy = "payout address " + payoutAddress;
							break poolLoop;
						}
					}
				}
			}

			for (var coinbaseTag in miningPoolsConfig.coinbase_tags) {
				if (miningPoolsConfig.coinbase_tags.hasOwnProperty(coinbaseTag)) {
					var coinbaseLower = minerInfo.coinbaseStr.toLowerCase();
					var coinbaseTagLower = coinbaseTag.toLowerCase();
					if (coinbaseLower.indexOf(coinbaseTagLower) != -1) {
						Object.assign(minerInfo, miningPoolsConfig.coinbase_tags[coinbaseTag]);
						minerInfo.identifiedBy = "coinbase tag '" + coinbaseTag + "' in '" + minerInfo.coinbaseStr + "'";
						break poolLoop;
					}
				}
			}

			for (var blockHash in miningPoolsConfig.block_hashes) {
				if (blockHash == tx.blockhash) {
					Object.assign(minerInfo, miningPoolsConfig.block_hashes[blockHash]);
					minerInfo.identifiedBy = "known block hash '" + blockHash + "'";
					break poolLoop;
				}
			}

			if ((!minerInfo.indentifiedBy) && (minerInfo.possibleSignal)) {
				minerInfo.name = minerInfo.possibleSignal;
				minerInfo.identifiedBy = "properly formatted signal e.g. '/tag/'";
				break poolLoop;
			}

		}
	}
	return minerInfo;
}

function getTxTotalInputOutputValues(tx, txInputs, blockHeight) {
	var totalInputValue = new Decimal(0);
	var totalOutputValue = new Decimal(0);

	try {
		for (var i = 0; i < tx.vin.length; i++) {
			if (tx.vin[i].coinbase) {
				totalInputValue = totalInputValue.plus(new Decimal(coinConfig.blockRewardFunction(blockHeight, global.activeBlockchain)));

			} else {
				var txInput = txInputs[i];

				if (txInput) {
					try {
						var vout = txInput;
						if (vout.value) {
							totalInputValue = totalInputValue.plus(new Decimal(vout.value));
						}
					} catch (err) {
						logError("2397gs0gsse", err, {txid:tx.txid, vinIndex:i});
					}
				}
			}
		}

		for (var i = 0; i < tx.vout.length; i++) {
			totalOutputValue = totalOutputValue.plus(new Decimal(tx.vout[i].value));
		}
	} catch (err) {
		logError("2308sh0sg44", err, {tx:tx, txInputs:txInputs, blockHeight:blockHeight});
	}

	return {input:totalInputValue, output:totalOutputValue};
}

// returns block reward for a given height
function getBlockReward(nHeight) {
	const nSubsidyHalvingInterval = 1050000;
	const halvings = Math.floor(nHeight / nSubsidyHalvingInterval);
	let initialBlockSubsidy = 10 * 1000000 * 100; // 10 mil nex in satoshis
	let blockRewardSat=Math.floor(initialBlockSubsidy/(halvings+1));
	var to_return = blockRewardSat / 100;
	return to_return.toFixed(2);
}

// returns the amount of minted NEX (100 satoshis) for a given height
function getCoinsMinted(nHeight = -1) {
	let totalMinted = 0;
	const nSubsidyHalvingInterval = 1050000;
	const halvings = Math.floor(nHeight / nSubsidyHalvingInterval);
	let nSubsidy = 10 * 1000000 * 100; // 10 mil nex in satoshis
	let trackedHeight = nHeight;

	for (let i = 0; i <= halvings; ++i) {
		if (trackedHeight >= nSubsidyHalvingInterval) {
			totalMinted += nSubsidy * nSubsidyHalvingInterval;
			trackedHeight -= nSubsidyHalvingInterval;
		} else {
			totalMinted += nSubsidy * trackedHeight;
		}
		nSubsidy = Math.floor(nSubsidy / 2);
	}
	var to_return = totalMinted / 100;
	return to_return.toFixed(2);
}

// translate bits to diffigulty (target)

function getDifficulty(nBits) {
	let nShift = (nBits >> 24) & 0xff;

	let dDiff = 0x0000ffff / (nBits & 0x00ffffff);

	while (nShift < 29) {
		dDiff *= 256.0;
		nShift++;
	}
	while (nShift > 29) {
		dDiff /= 256.0;
		nShift--;
	}

	return dDiff;
}

function getBlockTotalFeesFromCoinbaseTxAndBlockHeight(coinbaseTx, blockHeight) {
	if (coinbaseTx == null) {
		return 0;
	}

	var blockReward = coinConfig.blockRewardFunction(blockHeight, global.activeBlockchain);

	var totalOutput = new Decimal(0);
	for (var i = 0; i < coinbaseTx.vout.length; i++) {
		var outputValue = coinbaseTx.vout[i].value;
		if (outputValue > 0) {
			totalOutput = totalOutput.plus(new Decimal(outputValue));
		}
	}

	return totalOutput.minus(new Decimal(blockReward));
}

async function refreshExchangeRates() {
	if (!config.queryExchangeRates || config.privacyMode) {
		return;
	}

	if (coins[config.coin].exchangeRateData) {
		try {
			const response = await axios.get(coins[config.coin].exchangeRateData.jsonUrl);

			var exchangeRates = coins[config.coin].exchangeRateData.responseBodySelectorFunction(response.data);
			if (exchangeRates != null) {
				global.exchangeRates = exchangeRates;
				global.exchangeRatesUpdateTime = new Date();

				debugLog("Using exchange rates: " + JSON.stringify(global.exchangeRates) + " starting at " + global.exchangeRatesUpdateTime);
					getExchangeFromExchangeRateExtensions();
			} else {
				debugLog("Unable to get exchange rate data");
			}
		} catch(err) {
			logError("39r7h2390fgewfgds", err);
		}
	}
}

async function getExchangeFromExchangeRateExtensions() {
	// Any other extended currency conversion must use the BCHUSD base conversion rate to be calculated, in consecuence --no-rates must be disabled.
	var anyExtensionIsActive = coins[config.coin].currencyUnits.find(cu => cu.isExtendedRate) != undefined;
	if (anyExtensionIsActive && coins[config.coin].exchangeRateDataExtension.length > 0 && global.exchangeRates['usd']) {
		for (const exchangeProvider of coins[config.coin].exchangeRateDataExtension) {
			try {
				const response = await axios.get(exchangeProvider.jsonUrl);
				var responseBody = response.data;

				var exchangeRates = exchangeProvider.responseBodySelectorFunction(responseBody);
				if (exchangeRates != null || Object.entries(exchangeRates).length > 0) {
					var originalExchangeRates = global.exchangeRates;
					var extendedExchangeRates =  {};
					for (const  key in exchangeRates) {
						extendedExchangeRates[key] = (parseFloat(originalExchangeRates.usd) * parseFloat(exchangeRates[key])).toString();
					}
					global.exchangeRates = {
						...originalExchangeRates,
						...extendedExchangeRates
					}
					global.exchangeRatesUpdateTime = new Date();

					debugLog("Using extended exchange rates: " + JSON.stringify(global.exchangeRates) + " starting at " + global.exchangeRatesUpdateTime);

				} else {
					debugLog("Unable to get extended exchange rate data");
				}
			} catch(err) {
				logError("83ms2hsnw2je34zc2", err);
			}
		}
	}
}

async function loadGeoDataForIp(ipStr) {
	const apiUrl = `https://pro.ip-api.com/json/${ipStr}?key=${config.credentials.ipApiKey}`
	try {
		const response = await axios.get(apiUrl);
		const ip = response.data.query;
		if (response.data.lat && response.data.lon) {
			debugLog(`Successful IP-geo-lookup: ${ip} -> (${response.data.lat}, ${response.data.lon})`);
		} else {
			debugLog(`Unknown location for IP-geo-lookup: ${ip}`);
		}
		return response.data
	} catch (err) {
		debugLog("Failed IP-geo-lookup: " + ipStr);
		logError("39724gdge33a", err, {ip: ipStr});
		// we failed to get what we wanted, but there's no meaningful recourse,
		// so we log the failure and continue without objection
		return {}
	}
}

// Convert HSL to RGB https://stackoverflow.com/questions/36721830/convert-hsl-to-rgb-and-hex
function hslToHex(h, s, l) {
	l /= 100;
	const a = s * Math.min(l, 1 - l) / 100;
	const f = n => {
		const k = (n + h / 30) % 12;
		const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
		return Math.round(255 * color).toString(16).padStart(2, '0');   // convert to Hex and prefix "0" if needed
	};
	return `#${f(0)}${f(8)}${f(4)}`;
}

function stringToHexColor(inputString) {
	let hash = 0;
	for (let i = 0; i < inputString.length; i++) {
		hash = inputString.charCodeAt(i) + ((hash << 5) - hash);
	}

	let hue = Math.abs(hash % 360);

	let saturation = 60;
	let lightness = 55;

	return hslToHex(hue, saturation, lightness);
}

// Uses ipstack.com API
function geoLocateIpAddresses(peerSummary) {
	return new Promise(function(resolve, reject) {
		if (config.privacyMode || config.credentials.mapBoxKey === undefined) {
			resolve({});

			return;
		}
		const ipDetails = {ips: [], detailsByIp: {}};
		const promises = [];
		for (let i = 0; i < peerSummary.getpeerinfo.length; i++) {
			peerSummary.getpeerinfo[i].marker = stringToHexColor(peerSummary.getpeerinfo[i].subver)
			const ipWithPort = peerSummary.getpeerinfo[i].addr;
			if (ipWithPort.lastIndexOf(":") >= 0) {
				const ip = ipWithPort.substring(0, ipWithPort.lastIndexOf(":"));
				if (ip.trim().length > 0) {
					ipDetails.ips.push(ip.trim());
					ipDetails.detailsByIp[ip.trim()] = peerSummary.getpeerinfo[i]
					promises.push(coreApi.getGeoDataForIps(ip.trim(), ((ip) => () => loadGeoDataForIp(ip))(ip.trim())));
				}
			}
		}

		Promise.allSettled(promises).then(function(results) {
			for (const key in results) {
				if ((Object.keys(results[key].value).length > 0) && (results[key].value.status === "success")) {
					Object.assign(ipDetails.detailsByIp[results[key].value.query], results[key].value)
				}
			}

			resolve(ipDetails);
		}).catch(function(err) {
			debugLog("Failed IP-geo-lookup all promises: " + err)
			logError("80342hrf78wgehdf07gds", err);
			reject(err);
		});
	});
}

function parseExponentStringDouble(val) {
	var [lead,decimal,pow] = val.toString().split(/e|\./);
	return +pow <= 0
		? "0." + "0".repeat(Math.abs(pow)-1) + lead + decimal
		: lead + ( +pow >= decimal.length ? (decimal + "0".repeat(+pow-decimal.length)) : (decimal.slice(0,+pow)+"."+decimal.slice(+pow)));
}

var exponentScales = [
	{val:1000000000000000000000000000000000, name:"?", abbreviation:"V", exponent:"33"},
	{val:1000000000000000000000000000000, name:"?", abbreviation:"W", exponent:"30"},
	{val:1000000000000000000000000000, name:"?", abbreviation:"X", exponent:"27"},
	{val:1000000000000000000000000, name:"yotta", abbreviation:"Y", exponent:"24"},
	{val:1000000000000000000000, name:"zetta", abbreviation:"Z", exponent:"21"},
	{val:1000000000000000000, name:"exa", abbreviation:"E", exponent:"18"},
	{val:1000000000000000, name:"peta", abbreviation:"P", exponent:"15", textDesc:"Q"},
	{val:1000000000000, name:"tera", abbreviation:"T", exponent:"12", textDesc:"T"},
	{val:1000000000, name:"giga", abbreviation:"G", exponent:"9", textDesc:"B"},
	{val:1000000, name:"mega", abbreviation:"M", exponent:"6", textDesc:"M"},
	{val:1000, name:"kilo", abbreviation:"K", exponent:"3", textDesc:"thou"},
	{val:1, name:"", abbreviation:"", exponent:"0", textDesc:""}
];

function testExponentScaleIndex(n, exponentScaleIndex) {
	var item = exponentScales[exponentScaleIndex];
	var fraction = new Decimal(n / item.val);
	return {
		ok: fraction >= 1,
		fraction: fraction
	};
}

function getBestExponentScaleIndex(n) {
	if (n < 1)
		return exponentScales.length - 1;

	for (var i = 0; i < exponentScales.length; i++) {
		var res = testExponentScaleIndex(n, i);
		if (res.ok)
			return i;
	}
	throw new Error(`Unable to find exponent scale index for ${n}`);
}

function findBestCommonExponentScaleIndex(ns) {
	var best = ns.map(n => getBestExponentScaleIndex(n));
	return Math.max(...best);
}

function formatLargeNumber(n, decimalPlaces, exponentScaleIndex = undefined) {
	if (exponentScaleIndex === undefined)
		exponentScaleIndex = getBestExponentScaleIndex(n);

	var item = exponentScales[exponentScaleIndex];
	var fraction = new Decimal(n / item.val);
	return [fraction.toDecimalPlaces(decimalPlaces), item];
}

function rgbToHsl(r, g, b) {
	r /= 255, g /= 255, b /= 255;
	var max = Math.max(r, g, b), min = Math.min(r, g, b);
	var h, s, l = (max + min) / 2;

	if(max == min){
		h = s = 0; // achromatic
	}else{
		var d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		switch(max){
			case r: h = (g - b) / d + (g < b ? 6 : 0); break;
			case g: h = (b - r) / d + 2; break;
			case b: h = (r - g) / d + 4; break;
		}
		h /= 6;
	}

	return {h:h, s:s, l:l};
}

function colorHexToRgb(hex) {
	// Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
	var shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
	hex = hex.replace(shorthandRegex, function(m, r, g, b) {
		return r + r + g + g + b + b;
	});

	var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	return result ? {
		r: parseInt(result[1], 16),
		g: parseInt(result[2], 16),
		b: parseInt(result[3], 16)
	} : null;
}

function colorHexToHsl(hex) {
	var rgb = colorHexToRgb(hex);
	return rgbToHsl(rgb.r, rgb.g, rgb.b);
}


// https://stackoverflow.com/a/31424853/673828
const reflectPromise = p => p.then(v => ({v, status: "resolved" }),
							e => ({e, status: "rejected" }));

global.errorStats = {};

function logError(errorId, err, optionalUserData = null) {
	if (!global.errorLog) {
		global.errorLog = [];
	}

	if (!global.errorStats[errorId]) {
		global.errorStats[errorId] = {
			count: 0,
			firstSeen: new Date().getTime()
		};
	}

	global.errorStats[errorId].count++;
	global.errorStats[errorId].lastSeen = new Date().getTime();

	global.errorLog.push({errorId:errorId, error:err, userData:optionalUserData, date:new Date()});
	while (global.errorLog.length > 100) {
		global.errorLog.splice(0, 1);
	}

	debugErrorLog("Error " + errorId + ": " + err + ", json: " + JSON.stringify(err) + (optionalUserData != null ? (", userData: " + optionalUserData + " (json: " + JSON.stringify(optionalUserData) + ")") : ""));

	if (err && err.stack) {
		debugErrorVerboseLog("Stack: " + err.stack);
	}
	console.log(err)

	var returnVal = {errorId:errorId, error:err, errorMessage: err.message};
	if (optionalUserData) {
		returnVal.userData = optionalUserData;
	}
	return returnVal;
}

function buildQrCodeUrls(strings) {
	return new Promise(function(resolve, reject) {
		var promises = [];
		var qrcodeUrls = {};

		for (var i = 0; i < strings.length; i++) {
			promises.push(new Promise(function(resolve2, reject2) {
				buildQrCodeUrl(strings[i], qrcodeUrls).then(function() {
					resolve2();

				}).catch(function(err) {
					reject2(err);
				});
			}));
		}

		Promise.all(promises).then(function(results) {
			resolve(qrcodeUrls);

		}).catch(function(err) {
			reject(err);
		});
	});
}

function buildQrCodeUrl(str, results) {
	return new Promise(function(resolve, reject) {
		qrcode.toDataURL(str, function(err, url) {
			if (err) {
				logError("2q3ur8fhudshfs", err, str);

				reject(err);

				return;
			}

			results[str] = url;

			resolve();
		});
	});
}

function outputTypeAbbreviation(outputType) {
	var map = {
		"pubkeyhash": "p2pkh",
		"scripttemplate": "p2st",
		"nonstandard": "nonstandard",
		"nulldata": "nulldata"
	};

	if (map[outputType]) {
		return map[outputType];
	} else {
		return "???";
	}
}

function prettyScript(inScript, indentChar) {
	var indenter=["OP_IF", "OP_ELSE"]
	var outdenter=["OP_ENDIF", "OP_ELSE"]

	var s = inScript.split(" ");
	var shiftAmt=0;
	var i;
	var indenting = '';

	for (i = 0; i < s.length; i++) {
		var item=s[i];
		if (s[i].slice(0,2) == "OP")
		{
			s[i] = "<span class='exana-yellow'>" + s[i] + "</span>";
		}
		if (outdenter.includes(item)) shiftAmt -= 1;
		if (shiftAmt < 0) shiftAmt = 0;
		indenting = Array(shiftAmt).join(indentChar);
		s[i] = "<div style='text-indent: " + indenting  + "em'>" + s[i] + "</div>";
		if (indenter.includes(item)) shiftAmt += 1;
	}
	return s.join("\n");
}

function outputTypeName(outputType) {
	var map = {
		"pubkeyhash": "Pay to Public Key Hash",
		"scripttemplate": "Pay to Script Template",
		"nonstandard": "Non-Standard",
		"nulldata": "Null Data"
	};

	if (map[outputType]) {
		return map[outputType];
	} else {
		return "???";
	}
}

function serviceBitsToName (services) {
	var serviceBits = [];
	if (services & 1) { serviceBits.push('NODE_NETWORK'); }
	if (services & 2) { serviceBits.push('NODE_GETUTXO'); }
	if (services & 4) { serviceBits.push('NODE_BLOOM'); }
	if (services & 8) { serviceBits.push('NODE_WITNESS'); }
	if (services & 16) { serviceBits.push('NODE_XTHIN'); }
	if (services & 32) { serviceBits.push('NODE_CASH'); }
	if (services & 64) { serviceBits.push('NODE_GRAPHENE'); }
	if (services & 128) { serviceBits.push('NODE_WEAKBLOCKS'); }
	if (services & 256) { serviceBits.push('NODE_CF'); }
	if (services & 1024) { serviceBits.push('NODE_NETWORK_LIMITED'); }
	return serviceBits;
}

function getTransactionDatetime(utcEpochTime) {
	var epoch = new Date(0);
	epoch.setUTCSeconds(utcEpochTime);
	var formatted_date = epoch.getFullYear() + "-" + (epoch.getMonth() + 1) + "-" + epoch.getDate() + " " + epoch.toUTCString();

	return formatted_date;
}

function shortenAddress(address, threshold, wingLength) {
	let displayedAddress = "";
	if (address.length > threshold) {
		displayedAddress = address.substring(0,wingLength) + "..." + address.substring((address.length - wingLength))
	} else {
		displayedAddress = address;
	}
	return displayedAddress
}

function readUTXOSetForTokens() {
	let data = fs.readFileSync(path.resolve(config.utxoPath), {encoding:'utf8', flag:'r'});
	let lines = data.split(/\r?\n/);
	lines.pop();
	let tokens = new Set();

	lines.forEach(function(line) {
		let lineArray = line.split(',');
		try {
			if (Address.fromString(lineArray[5]).isGroupIdentifierAddress()) tokens.add(lineArray[5]);
		} catch (err) {
		}
	});
	tokens = [...tokens];
	return tokens
}

function readRichList () {
	let data = fs.readFileSync(path.resolve(config.richListPath), {encoding:'utf8', flag:'r'});
	let lines = data.split(/\r?\n/);
	lines.pop();
	let parsedLines = [];
	let parsedLine;
	let i = 0;
	let coinsDistr = [["Top 25",0,0],["Top 26-50",0,0],["Top 51-75",0,0],["Top 76-100",0,0],["Total",0,0]];
	lines.forEach(function(line) {
		let lineArray = line.split(',');
		let displayedAddress = shortenAddress(lineArray[3], 54, 21);
		parsedLine = {
			rank: Number(lineArray[0]),
			balance: Number(lineArray[1]),
			height: Number(lineArray[2]),
			address: lineArray[3],
			formatAddress : displayedAddress,
			percent: Number(lineArray[4])
		};
		parsedLines.push(parsedLine);
		// Skip the address with more coin because it is MEXC cold/hot wallet.
		// Keeping it while computing EXANA coins distribution is not fair cause
		// it gives a biased idea of the EXANA coins distribution.
		if (i > 0) {
			coinsDistr[4][1] += parsedLine.balance;
			coinsDistr[4][2] += parsedLine.percent;
			coinsDistr[Math.floor(i/25)][1] += parsedLine.balance;
			coinsDistr[Math.floor(i/25)][2] += parsedLine.percent;
		}
		i++;
	});
	return [parsedLines, coinsDistr];
}


const obfuscateProperties = (obj, properties) => {
	if (process.env.BTCEXP_SKIP_LOG_OBFUSCATION) {
		return obj;
	}

	let objCopy = Object.assign({}, obj);

	properties.forEach(name => {
		objCopy[name] = "*****";
	});

	return objCopy;
}

// The following 2 functions are needed when using "json parse with source" tc39
// v8 modification available only while using nodejs >=20

// This will let us use an experimental version of v8 engine that
// fixes JSON BigInt parsing/stringifying problem.
//
// See the following links for more detail:
//
// - https://jsoneditoronline.org/indepth/parse/why-does-json-parse-corrupt-large-numbers/
// - https://github.com/tc39/proposal-json-parse-with-source
// - https://2ality.com/2022/11/json-parse-with-source.html
//
// The TC39 change proposal is called json parse with souirce and it has already been
// implemented in google v8 since version 10.9.1, see:
//
// https://chromium.googlesource.com/v8/v8/+/refs/heads/10.9.1/src/flags/flag-definitions.h#222

const bigIntToRawJSON = function(key, val) {
	if (typeof val === "bigint" ) {
		return JSON.rawJSON(String(val));
	} else {
		return val;
	}
}

const intToBigInt = function(key, val, unparsedVal) {
	// if val belongs to the number type, it is bigger than max safe integer,
	// and it's not a rational number, then convert it to BigInt starting from
	// the orginal unparsed value.
	if (typeof val === 'number' && (val > Number.MAX_SAFE_INTEGER || val < Number.MIN_SAFE_INTEGER) && val % 1 == 0) {
		// BigInt() can't parse string that ends wiht '.00' and e.g. 11.00 % 1
		// returns 0 so we need to take into account this special case.
		let regex = /^[0-9]+\.[0]{2}$/;
		let toParse = unparsedVal.source;
		if (regex.test(toParse)) {
			return BigInt(toParse.slice(0,-3));
		} else {
			return BigInt(unparsedVal.source);
		}
	} else {
		return val;
	}
}


/**
 * Given a 32-byte hex-encoded token category, return a deterministic hue and
 * saturation value to use in HSL colors representing the token category.
 * Usage: `hsl(${ tokenID2HueSaturation(vout.tokenData.category) }, 50%)`
 */
function tokenID2HueSaturation(groupIdEncoded) {
	let groupId = Address.fromString(groupIdEncoded)
	if (GroupToken.isSubgroup(groupIdEncoded)) {
		// this is asubgroup which contains the parent group id in the first 32 bytes
		groupId = new Address(Buffer.from(groupId.data.subarray(0, 32)), groupId.network, AddressType.GroupIdAddress)
	}
	const raw = groupId.data.reduce((acc, num) => acc * num, 1) % 36000;
	const hue = (raw / 100).toFixed(0);
	const saturation = Math.min(100, (raw / 360 + 50)).toFixed(0);
	return `${hue},${saturation}%`;
}

function tokenID2HexString(groupIdEncoded) {
	let groupId = Address.fromString(groupIdEncoded).data
	if (GroupToken.isSubgroup(groupIdEncoded)) {
		// this is asubgroup which contains the parent group id in the first 32 bytes
		groupId = groupId.subarray(0, 32);
	}
	return uint8Array2hexstring(groupId);
}
/**
 * Given groupAuthotiry encoede as 64buit unsigned BigInt, return the a map
 * rappresenting the 6 most significant digits of the given value encoded
 * as a binary. Each digit as a particular meaning as described here:
 * https://gitlab.com/nexa/nexa/-/blame/dev/src/consensus/grouptokens.h#L28
 *
 * The following is the C++ code that defines the meaning of those digits:
 *
 * enum class GroupAuthorityFlags : uint64_t
 * {
 *     AUTHORITY = 1ULL << 63, // Is this a controller utxo (forces negative number in amount)
 *     MINT = 1ULL << 62, // Can mint tokens
 *     MELT = 1ULL << 61, // Can melt tokens,
 *     BATON = 1ULL << 60, // Can create controller outputs
 *     RESCRIPT = 1ULL << 59, // Can change the redeem script
 *     SUBGROUP = 1ULL << 58,

 *     NONE = 0,
 *     ACTIVE_FLAG_BITS = AUTHORITY | MINT | MELT | BATON | RESCRIPT | SUBGROUP,
 *     ALL_FLAG_BITS = 0xffffULL << (64 - 16),
 *     RESERVED_FLAG_BITS = ACTIVE_FLAG_BITS & ~ALL_FLAG_BITS
 * };
 */
function tokenAuthToFlags(groupAuth) {
	const groupAuthBinary = BigInt.asUintN(64,String(groupAuth)).toString(2);
	const stringFlags = groupAuthBinary.substr(0,6);
	let authFlags = ['Authority', 'Mint', 'Melt', 'Baton', 'Rescript', 'Subgroup']
	let activeFlags = [];
	for (let i in stringFlags) {
		// skip showing "authority" because that is implied by showing any flags
		if ((stringFlags[i] == '1') && (i > 0)) {
			activeFlags.push(authFlags[i]);
		}
	}
	return activeFlags;
}

function knownTokens(chain) {
	let tokens = [];
	if (chain === "exana") {
		tokens = [
			
		];
	} else {
		//testnet
	}
	return tokens;
}

function knownNFTProviders(chain) {
	if (chain === "exana") {
		return [
			 
		]
	} else {
		return [];
	}
}

function isValidHttpUrl(string) {
	let url;

	try {
	  url = new URL(string);
	} catch (_) {
	  return false;
	}

	return url.protocol === "http:" || url.protocol === "https:";
}

async function parseGroupData(tokenSet, NFTSet, inOutGroup, chain){
	const decodedAddress = Address.fromString(inOutGroup)
	const groupSizeInBytes = decodedAddress.data

	//Assume its a token
	if (groupSizeInBytes.length === 32) {
		if (!tokenSet.has(inOutGroup)) {
			tokenSet.add(inOutGroup);
		}
	}
	// Assume that this "Could" be an NFT
	else if (groupSizeInBytes > 32 && groupSizeInBytes <= 64) {
		var parentGroupInBytes = decodedAddress.data.subarray(0, 32);
		var encodedGroup = new Address(parentGroupInBytes, decodedAddress.network, AddressType.GroupIdAddress).toString()
		if(knownNFTProviders(chain).includes(encodedGroup)){
			if(!NFTSet.has(inOutGroup)) {
				NFTSet.add(inOutGroup)
			}
			// we have an NFT lets add it to the collection
		} else {
			debugLog("We shouldnt be here with an NFT");
		}
	} else {
		let result = null
		try{
			result = await coreApi.getTokenGenesis(inOutGroup)
		} catch (e) {
			if (!tokenSet.has(inOutGroup)) {
				tokenSet.add(inOutGroup);
			}
			return
		}
		if (result.op_return != null) {
			let opReturnScript = new Script(result.op_return)
			if (opReturnScript.chunks.length < 1) {
				return;
			}
			switch (opReturnScript) {
				case opReturnScript.getGroupIdType() === GroupIdType.NRC3:
					NFTSet.add(inOutGroup)
					break;
				case opReturnScript.getGroupIdType() === GroupIdType.LEGACY:
				case opReturnScript.getGroupIdType() === GroupIdType.NRC1:
				case opReturnScript.getGroupIdType() === GroupIdType.NRC2:
					tokenSet.add(inOutGroup);
					break;
			}

		} else {
			tokenSet.add(inOutGroup);
		}
	}
}
function isNullOrEmpty(arg) {
    return !arg || arg.length === 0;
}

function collapseLicense(jsonString) {
    // Regular expression to find the license field
    const licenseRegex = /("license":\s*")([\s\S]*?)(")/;

    // Function to replace newlines and escape quotes within the license field
    const fixedJson = jsonString.replace(licenseRegex, function(match, p1, p2, p3) {
        // Collapse the license field into one line and escape double quotes
        const collapsedLicense = p2.replace(/\n/g, ' ').replace(/"/g, '\\"');
        return p1 + collapsedLicense + p3;
    });

    return fixedJson;
}


async function loadNFTData(zipData, providerName) {
	let files = [];
	let data = {};
	let zip = null

	try {
		zip = await JSZip.loadAsync(zipData, {base64: true});
	} catch (e) {
		debugLog("Cannot open zip file")
		return {
			nftMetadata: data,
			nftFiles: files
		}
	}
	if(providerName.includes("Nebula")){
		return parseNebulaNFT(zip)
	} else {
		return parseNiftyNFT(zip)
	}
}

async function parseNebulaNFT(zip) {
	let files = [];
	let data = {};

	try {
		let info = zip.file('info.json');
		if (info) {
			let infoJson = await info.async('string');
			let infoObj = JSON.parse(infoJson);
			data = {
				nrc: infoObj?.nrc ?? '',
				name: infoObj?.name ?? '',
				attributes: infoObj?.attributes ?? '',
				data: infoObj?.data ?? {},
				bindata: infoObj?.bindata ?? {},
				author: infoObj?.author ?? ''
			};
		}
	} catch(err){
		debugLog("cannot parse NFT json data", err)
	}


	let pubImg = zip.file(/^public\./);
	if (!isNullOrEmpty(pubImg)) {
		let img = await pubImg[0].async('base64');
		files.push({ title: 'Public', image: img });
	}

	let frontImg = zip.file(/^front\./);
	if (!isNullOrEmpty(frontImg)) {
		let img = await frontImg[0].async('base64');
		files.push({ title: 'Front', image: img });
	}

	let backImg = zip.file(/^back\./);
	if (!isNullOrEmpty(backImg)) {
		let img = await backImg[0].async('base64');
		files.push({ title: 'Back', image: img });
	}

	let ownImg = zip.file(/^owner\./);
	if (!isNullOrEmpty(ownImg)) {
		let img = await ownImg[0].async('base64');
		files.push({ title: 'Owner', image: img });
	}
	return {
		nftMetadata: data,
		nftFiles: files
	}
}
async function parseNiftyNFT(zip) {
	let files = [];
	let data = {};
	try {
		let info = zip.file('info.json');
		if (info) {
			let infoJson = await info.async('string');
			let myEscapedJSONString = collapseLicense(infoJson)
			let infoObj = JSON.parse(myEscapedJSONString);

			data = {
				niftyVer: infoObj?.niftyVer ?? '',
				name: infoObj?.title ?? '',
				collection: infoObj?.series ?? '',
				author: infoObj?.author ?? '',
				keywords: infoObj?.keywords ?? '',
				category: infoObj?.category ?? [],
				appuri: infoObj?.appuri ?? '',
				info: infoObj?.info ?? '',
				data: infoObj?.data ?? {},
				license: infoObj?.license ?? ''
			};
		}
	} catch(err){
		debugLog("cannot parse NFT json data", err)
	}


	let pubImg = zip.file(/^public\./);
	if (!isNullOrEmpty(pubImg)) {
		let img = await pubImg[0].async('base64');
		files.push({ title: 'Public', image: img });
	}

	let frontImg = zip.file(/^cardf\./);
	if (!isNullOrEmpty(frontImg)) {
		let img = await frontImg[0].async('base64');
		files.push({ title: 'Front', image: img });
	}

	let backImg = zip.file(/^cardb\./);
	if (!isNullOrEmpty(backImg)) {
		let img = await backImg[0].async('base64');
		files.push({ title: 'Back', image: img });
	}

	let ownImg = zip.file(/^owner\./);
	if (!isNullOrEmpty(ownImg)) {
		let img = await ownImg[0].async('base64');
		files.push({ title: 'Owner', image: img });
	}
	return {
		nftMetadata: data,
		nftFiles: files
	}
}
async function loadGroupDataSlow(filteredTokens, isNfts = false){
	for (const token of filteredTokens) {
		try {
			await tokenProcessQueue.createJob({token: token, isNFT: isNfts})
				.timeout(30000)
				.retries(2)
				.save()
		} catch (err) {
			debugLog(err);
		}
	}
}

// Calculate the forward page number based on total items, page size, and reverse page number
function calculateForwardPage(totalItems, pageSize, reversePage) {
	const totalTransfers = totalItems.total
	const totalPages = Math.ceil(totalTransfers / pageSize);
    const forwardPage = totalPages - reversePage + 1;
    return Math.max(forwardPage, 1);
}



function getBadgeForType(type){
	switch(type){
		case "TRANSFER":
			return "badge-primary";
		case "MELT":
			return "badge-danger";
		case "MINT":
			return "badge-success";
		case "CREATE":
			return "badge-info";
		default:
			return "badge-primary"
	}
}

function removePublicFromFile(filePath) {
    if (filePath.startsWith("public/")) {
        // Remove the "public/" prefix
        return filePath.substring(6);
    }
    return filePath;
}

const fileTypes = {
    images: ['avif', 'webp', 'svg', 'gif', 'png', 'apng', 'jpg', 'jpeg', 'AVIF', 'WEBP', 'SVG', 'GIF', 'PNG', 'APNG', 'JPG', 'JPEG'],
    audio: ['ogg', 'OGG', 'mp3', 'MP3', 'wav', 'WAV', 'flac', 'FLAC'],
    video: ['mp4', 'mpeg', 'mpg', 'webm', 'MP4', 'MPEG', 'MPG', 'WEBM']
};

function getFileType(extension) {
    if (fileTypes.images.includes(extension)) {
        return 'image';
    } else if (fileTypes.audio.includes(extension)) {
        return 'audio';
    } else if (fileTypes.video.includes(extension)) {
        return 'video';
    } else {
        return 'unknown';
    }
}

function searchResponse(req, res, query, data, wantsJson = false) {
	if(wantsJson) {
		res.set('Content-Type', 'text/json')
		res.send(data)
	} else {
		if(data.length > 0) {
			res.redirect(data[0].value);
		}
		req.session.userMessage = "No results found for query: " + query;
		res.redirect("/");
	}
}

async function search(req, res, wantsJson = false) {
	if(wantsJson) {
		var query = req.query.q.toLowerCase().trim();
		var rawCaseQuery = req.query.q.trim();

		req.session.query = req.query.q;
	}else {
		var query = req.body.query.toLowerCase().trim();
		var rawCaseQuery = req.body.query.trim();

		req.session.query = req.body.query;
	}

	if (query.length == 64) {
		// this could be a successful retrieve produced
		// by a seach vy txid, txidem or outpoint
		coreApi.getRawTransaction(query).then(function(tx) {
			if (tx) {
				// always use txidem as query param independently
				// by which mean we searched in the first place
				const data = [{value: "/tx/" + query, text: query}]
				searchResponse(req, res, query, data, wantsJson)
			}

			coreApi.getBlockHeader(query).then(function(blockHeader) {
				if (blockHeader) {
					const data = [{value: "/block/" + query, text: query}]
					searchResponse(req, res, query, data, wantsJson)
				}

				coreApi.getAddress(rawCaseQuery).then(function(validateaddress) {
					if (validateaddress && validateaddress.isvalid) {
						const data = [{value: "/address/" + rawCaseQuery, text: query}]
						searchResponse(req, res, query, data, wantsJson)
					}
				});

				try {
					let decodedAddress = Address.fromString(query)

					if(decodedAddress.isGroupIdentifierAddress()) {
						const data = [{value: "/token/" + query, text: query}]
						searchResponse(req, res, query, data, wantsJson)
					}
				} catch (err) {}

				const data = []
				searchResponse(req, res, query, data, wantsJson)

			}).catch(function(err) {
				const data = []
				searchResponse(req, res, query, data, wantsJson)
			});

		}).catch(function(err) {
			coreApi.getBlockHeader(query).then(function(blockHeader) {
				if (blockHeader) {
					const data = [{value: "/block/" + query, text: query}]
					searchResponse(req, res, query, data, wantsJson)
				}

				const data = []
				searchResponse(req, res, query, data, wantsJson)

			}).catch(function(err) {
				const data = []
				searchResponse(req, res, query, data, wantsJson)
			});
		});

	} else if (!isNaN(query)) {
		coreApi.getBlockHeaderByHeight(parseInt(query)).then(function(blockHeader) {
			if (blockHeader) {
				const data = [{value: "/block-height/" + query, text: query}]
				searchResponse(req, res, query, data, wantsJson)
			}

			const data = []
			searchResponse(req, res, query, data, wantsJson)
		}).catch(function (err) {
			const data = []
			searchResponse(req, res, query, data, wantsJson)
		});

	} else {

		try {
			const validatedAddress = await coreApi.getAddress(rawCaseQuery);
			if (validatedAddress && validatedAddress.isvalid) {
				const data = [{value: "/address/" + rawCaseQuery, text: query}]
				searchResponse(req, res, query, data, wantsJson)
			}

			let decodedAddress = Address.fromString(query)

			if(decodedAddress.isGroupIdentifierAddress()) {
				const data = [{value: "/token/" + query, text: query}]
				searchResponse(req, res, query, data, wantsJson)
			}
		} catch (err) {
			logError("2237badAddress",err);
		}
		let data = []
		try {
			const dbresult = await db.Token.findAll({
				where: {
					[Op.or]: [
					  { group: { [Op.like]: `%${query}%` } },
					  { name: { [Op.like]: `%${query}%` } },
					  { ticker: { [Op.like]: `%${query}%` } },
					  { collection: { [Op.like]: `%${query}%` } },
					  { author: { [Op.like]: `%${query}%` } }
					]
				  }
			})
			if(dbresult.length > 0) {
				const mappedResult = dbresult.map(token => ({
					value: `/token/${token.group}`,
					text: `${token.is_nft ? 'NFT' : 'Token'}: ${token.name ?? token.group}`
				}));

				// Concatenate mappedResult onto data array
  				data = data.concat(mappedResult);
			}
		} catch(err) {
			debugLog(err)
		}

		try {
			const dbresult = await db.Collection.findAll({
				where: {
					[Op.or]: [
					  { author: { [Op.like]: `%${query}%` } },
					  { name: { [Op.like]: `%${query}%` } },
					]
				  }
			})
			if(dbresult.length > 0) {
				const mappedResult = dbresult.map(collection => ({
					value: `/collection/${collection.identifier}`,
					text: "NFT Collection: " + collection.name
				}));

				// Concatenate mappedResult onto data array
  				data = data.concat(mappedResult);
			}
		} catch(err) {}

		searchResponse(req, res, query, data, wantsJson)
	}
}

function sortChartData (labels, data) {
	const arrayOfObj = labels.map(function(d, i) {
		return {
			label: d,
			data: data[i] || 0
		};
	});

	const sortedArrayOfObj = arrayOfObj.sort(function(a, b) {
		return b.data - a.data;
	});

	const newArrayLabel = [];
	const newArrayData = [];
	sortedArrayOfObj.forEach(function(d){
		newArrayLabel.push(d.label);
		newArrayData.push(d.data);
	});
	return {labels: newArrayLabel, data: newArrayData}
}

export default {
	readRichList,
	reflectPromise,
	redirectToConnectPageIfNeeded,
	hex2ascii,
	hex2array,
	hex2string,
	splitArrayIntoChunks,
	splitArrayIntoChunksByChunkCount,
	getRandomString,
	getCurrencyFormatInfo,
	formatCurrencyAmount,
	formatCurrencyAmountWithForcedDecimalPlaces,
	formatExchangedCurrency,
	formatValueInActiveCurrency,
	satoshisPerUnitOfActiveCurrency,
	addThousandsSeparators,
	formatCurrencyAmountInSmallestUnits,
	seededRandom,
	seededRandomIntBetween,
	logMemoryUsage,
	getMinerFromCoinbaseTx,
	getMinerCustomData,
	getBlockReward,
	getBlockTotalFeesFromCoinbaseTxAndBlockHeight,
	getCoinsMinted,
	getDifficulty,
	refreshExchangeRates,
	parseExponentStringDouble,
	findBestCommonExponentScaleIndex,
	formatLargeNumber,
	geoLocateIpAddresses,
	getTxTotalInputOutputValues,
	rgbToHsl,
	colorHexToRgb,
	colorHexToHsl,
	logError,
	buildQrCodeUrls,
	ellipsize,
	shortenTimeDiff,
	prettyScript,
	outputTypeAbbreviation,
	outputTypeName,
	serviceBitsToName,
	perfMeasure,
	getTransactionDatetime,
	obfuscateProperties,
	bigIntToRawJSON,
	intToBigInt,
	shortenAddress,
	tokenID2HueSaturation,
	tokenAuthToFlags,
	tokenID2HexString,
	knownTokens,
	knownNFTProviders,
	loadNFTData,
	readUTXOSetForTokens,
	isValidHttpUrl,
	parseGroupData,
	loadGroupDataSlow,
	getBadgeForType,
	removePublicFromFile,
	getFileType,
	search,
	padSatoshiValues,
	calculateForwardPage,
	sortChartData
};
