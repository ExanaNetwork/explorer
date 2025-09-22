import Decimal from "decimal.js";
const Decimal2 = Decimal.clone({ precision: 2, rounding: 2 });

var currencyUnits = [
	{
		type:"native",
		name:"EXA",
		multiplier:1,
		default:true,
		values:["", "exa", "EXA"],
		decimalPlaces:8
	},
	{
		type:"native",
		name:"energy",
		multiplier:100000000,
		values:["energy", "energy"],
		decimalPlaces:0
	},
	{
		type:"exchanged",
		name:"USDT",
		multiplier:"usdt",
		values:["usdt"],
		decimalPlaces:8,
		symbol:"$"
	},
	{
		type:"exchanged",
		name:"ARS",
		multiplier:"ars",
		values:["ars"],
		decimalPlaces:2,
		symbol:"$",
		isExtendedRate: true
	},
];

export default {
	name:"Exana",
	ticker:"EXA",
	logoUrl:"/img/logo/exa.png",
	faviconUrl:"/img/logo/exa.ico",
	siteTitle:"Exana Explorer",
	siteTitleHtml:"Exana Explorer",
	siteDescriptionHtml:"<b>Exana Explorer</b> is <a href='https://github.com/ExanaNetwork/explorer). If you run your own Exana Full Node, **EXA Explorer** can easily run alongside it, communicating via RPC calls. See the project [ReadMe](https://gitlab.com/exana/exa-rpc-explorer/README.md) for a list of features and instructions for running.",
	nodeTitle:"Exana Full Node",
	nodeUrl:"https://exana.org/download",
	demoSiteUrl: "https://explorer.exana.org",
	miningPoolsConfigUrls:["https://exana.org"],
	difficultyAdjustmentBlockOffset: 20160,
	difficultyAdjustmentBlockCount: 4,
	maxSupplyByNetwork: {
		"exana": new Decimal(20947497500), // 1 EXA = 100,000,000 energy, which means 8 decimal digit precision
		"test": new Decimal(20947497500),
		"regtest": new Decimal(20947497500)
	},
	targetBlockTimeSeconds: 30,
	targetBlockTimeMinutes: 0.5,
	currencyUnits:currencyUnits,
	currencyUnitsByName:{"EXA":currencyUnits[0], "KEXA":currencyUnits[1], "MEXA":currencyUnits[2], "sat":currencyUnits[3], "USDT":currencyUnits[4]},
	baseCurrencyUnit:currencyUnits[3],
	defaultCurrencyUnit:currencyUnits[0],
	feeSatoshiPerByteBucketMaxima: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 50, 75, 100, 150],
// need to be chainged once we get it lunched
	genesisBlockHashesByNetwork:{
		"main":    "edc7144fe1ba4edd0edf35d7eea90f6cb1dba42314aa85da8207e97c5339c801",
		"test":    "508c843a4b98fb25f57cf9ebafb245a5c16468f06519cdd467059a91e7b79d52",
		"regtest": "d71ee431e307d12dfef31a6b21e071f1d5652c0eb6155c04e3222612c9d0b371"
	},
	genesisCoinbaseTransactionIdsByNetwork: {
		"main":    "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
		"test":    "bced5e4146c9b486b468023dd4f33b00d4e62c14a5c8cfc93f4c51f6246325dd",
		"regtest": "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b"
	},
	genesisCoinbaseTransactionsByNetwork:{
		"main": {
			"in_txpool": false,
			"in_orphanpool": false,
			"txid": "9173ec5d14df32ea30470ef85770aeaab8faf046e58e8c61944b1fe422b5afcd",
			"txidem": "17c6bd3bbf76c3225482a370f4eda4c63f894e0ed00a75b223f7b91875f292e1",
			"size": 188,
			"version": 0,
			"locktime": 0,
			"spends": 0,
			"sends": 0,
			"fee": 0,
			"vin": [],
			"vout": [
				{
					"value": 0,
					"type": 0,
					"n": 0,
					"scriptPubKey": {
						"asm": "0",
						"hex": "00",
						"type": "nonstandard"
					},
					"outpoint": "1bed9d880d0523818bd3f3bde7cd45733f28a96dfdea2b5c7328d6f433a97d42"
				},
				{
					"value": 0,
					"type": 0,
					"n": 1,
					"scriptPubKey": {
						"asm": "OP_RETURN 0 7227 526575746572733a204a6170616e20504d204b697368696461206261636b7320424f4a20756c7472612d6561737920706f6c696379207768696c652079656e20776f7272696573206d6f756e74204254433a3734313731313a30303030303030303030303030303030303030373566346263303865316437386133616233616638323734643133333334633061633264653235333039373638",
						"hex": "6a00023b1c4c99526575746572733a204a6170616e20504d204b697368696461206261636b7320424f4a20756c7472612d6561737920706f6c696379207768696c652079656e20776f7272696573206d6f756e74204254433a3734313731313a30303030303030303030303030303030303030373566346263303865316437386133616233616638323734643133333334633061633264653235333039373638",
						"type": "nulldata"
					},
					"outpoint": "3719996d2506c0032901d593b91b6a6ee7134128b26c054eafa26b23a9718127"
				}
			],
			"blockhash": "edc7144fe1ba4edd0edf35d7eea90f6cb1dba42314aa85da8207e97c5339c801",
			"confirmations": 12837,
			"time": 1655812800,
			"blocktime": 1655812800,
			"hex": "0000020000000000000000000100000000000000000000a06a00023b1c4c99526575746572733a204a6170616e20504d204b697368696461206261636b7320424f4a20756c7472612d6561737920706f6c696379207768696c652079656e20776f7272696573206d6f756e74204254433a3734313731313a3030303030303030303030303030303030303037356634626330386531643738613361623361663832373464313333333463306163326465323533303937363800000000"
		},
		"test": {
			"hex": "00000200000000000000000001510000000000000000001a6a00023b1c1474686973206973206e65786120746573746e657400000000",
			"txid": "bced5e4146c9b486b468023dd4f33b00d4e62c14a5c8cfc93f4c51f6246325dd",
			"hash": "bced5e4146c9b486b468023dd4f33b00d4e62c14a5c8cfc93f4c51f6246325dd",
			"txidem": "d5b2ac385e837833b66835c7b70b509cb8241bf445f83853ebf4abcf30e919c6",
			"version": 0,
			"size": 54,
			"locktime": 0,
			"confirmations": 9560,
			"vin": [
				{
				}
			],
			"vout": [
				{
					"value": 0.00,
					"type": 0,
					"n": 0,
					"scriptPubKey": {
						"asm": "1",
						"hex": "51",
						"type": "nonstandard",
					},
					"outpoint": "9e24ffa1ec51308a1aa5b0d8f68c1d6ad9c7a2e3a2c7eef2002d4928f67fbab9"
				},
				{
					"value": 0.00,
					"type": 0,
					"n": 1,
					"scriptPubKey": {
						"asm": "OP_RETURN 0 7227 74686973206973206e65786120746573746e6574",
						"hex": "6a00023b1c1474686973206973206e65786120746573746e6574",
						"type": "nulldata",
					},
					"outpoint": "c6fa649720f4ac52265c87ff3970add752780e0fc90bd251c2cf403d44734b7"
				}
			],
			"blockhash": "508c843a4b98fb25f57cf9ebafb245a5c16468f06519cdd467059a91e7b79d52",
			"time": 1649953806,
			"blocktime": 1649953806
		},
		"regtest": {
			"hex": "01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000",
			"txid": "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
			"hash": "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
			"version": 1,
			"size": 204,
			"locktime": 0,
			"vin": [
				{
					"coinbase": "04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73",
					"sequence": 4294967295
				}
			],
			"vout": [
				{
					"value": 50.00000000,
					"n": 0,
					"scriptPubKey": {
						"asm": "04678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5f OP_CHECKSIG",
						"hex": "4104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac",
						"type": "pubkey"
					}
				}
			],
			"blockhash": "0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206",
			"time": 1296688602,
			"blocktime": 1296688602
		}
	},
	genesisBlockStatsByNetwork:{
		"main": {
			"avgfee": 0,
			"avgfeerate": 0,
			"avgtxsize": 0,
			"blockhash": "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f",
			"feerate_percentiles": [
				0,
				0,
				0,
				0,
				0
			],
			"height": 0,
			"ins": 0,
			"maxfee": 0,
			"maxfeerate": 0,
			"maxtxsize": 0,
			"medianfee": 0,
			"mediantime": 1231006505,
			"mediantxsize": 0,
			"minfee": 0,
			"minfeerate": 0,
			"mintxsize": 0,
			"outs": 1,
			"subsidy": 50,
			"time": 1231006505,
			"total_out": 0,
			"total_size": 0,
			"totalfee": 0,
			"txs": 1,
			"utxo_increase": 1,
			"utxo_size_inc": 117
		},
		"test": {
			"avgfee": 0,
			"avgfeerate": 0,
			"avgtxsize": 0,
			"blockhash": "000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943",
			"feerate_percentiles": [
				0,
				0,
				0,
				0,
				0
			],
			"height": 0,
			"ins": 0,
			"maxfee": 0,
			"maxfeerate": 0,
			"maxtxsize": 0,
			"medianfee": 0,
			"mediantime": 1296688602,
			"mediantxsize": 0,
			"minfee": 0,
			"minfeerate": 0,
			"mintxsize": 0,
			"outs": 1,
			"subsidy": 50,
			"time": 1296688602,
			"total_out": 0,
			"total_size": 0,
			"totalfee": 0,
			"txs": 1,
			"utxo_increase": 1,
			"utxo_size_inc": 117
		},
		"test4": {
			"avgfee": 0,
			"avgfeerate": 0,
			"avgtxsize": 0,
			"blockhash": "000000001dd410c49a788668ce26751718cc797474d3152a5fc073dd44fd9f7b",
			"feerate_percentiles": [
				0,
				0,
				0,
				0,
				0
			],
			"height": 0,
			"ins": 0,
			"maxfee": 0,
			"maxfeerate": 0,
			"maxtxsize": 0,
			"medianfee": 0,
			"mediantime": 1296688602,
			"mediantxsize": 0,
			"minfee": 0,
			"minfeerate": 0,
			"mintxsize": 0,
			"outs": 1,
			"subsidy": 50,
			"time": 1296688602,
			"total_out": 0,
			"total_size": 0,
			"totalfee": 0,
			"txs": 1,
			"utxo_increase": 1,
			"utxo_size_inc": 117
		},
		"scale": {
			"avgfee": 0,
			"avgfeerate": 0,
			"avgtxsize": 0,
			"blockhash": "00000000e6453dc2dfe1ffa19023f86002eb11dbb8e87d0291a4599f0430be52",
			"feerate_percentiles": [
				0,
				0,
				0,
				0,
				0
			],
			"height": 0,
			"ins": 0,
			"maxfee": 0,
			"maxfeerate": 0,
			"maxtxsize": 0,
			"medianfee": 0,
			"mediantime": 1296688602,
			"mediantxsize": 0,
			"minfee": 0,
			"minfeerate": 0,
			"mintxsize": 0,
			"outs": 1,
			"subsidy": 50,
			"time": 1296688602,
			"total_out": 0,
			"total_size": 0,
			"totalfee": 0,
			"txs": 1,
			"utxo_increase": 1,
			"utxo_size_inc": 117
		}
	},
	genesisCoinbaseOutputAddressScripthash:"8b01df4e368ea28f8dc0423bcf7a4923e3a12d307c875e47a0cfbf90b5c39161",
	historicalData: [
		{
			type: "blockheight",
			date: "2022-04-14",
			chain: "test",
			blockHeight: 0,
			blockHash: "508c843a4b98fb25f57cf9ebafb245a5c16468f06519cdd467059a91e7b79d52",
			summary: "Exana Testnet Genesis Block.",
			alertBodyHtml: "This is the first block in the Exana testnet blockchain, known as the 'Genesis Block'",
			referenceUrl: "https://exana.ai"
		},
		{
			type: "blockheight",
			date: "2022-06-21",
			chain: "main",
			blockHeight: 0,
			blockHash: "edc7144fe1ba4edd0edf35d7eea90f6cb1dba42314aa85da8207e97c5339c801",
			summary: "Exana Mainnet Genesis Block.",
			alertBodyHtml: "This is the first block in the Exana mainnet blockchain, known as the 'Genesis Block'",
			referenceUrl: "https://exana.ai"
		}
	],
	exchangeRateData:{
		jsonUrl:"https://api.mexc.com/api/v3/ticker/price?symbol=EXANAUSDT",
		responseBodySelectorFunction:function(responseBody) {
			if (responseBody.price) {
				var exchangeRates = {};
				exchangeRates["usdt"] = responseBody.price;
				return exchangeRates;
			}

			return null;
		}
	},
	exchangeRateDataExtension:[
		{
			jsonUrl:"https://api.yadio.io/exrates",
			responseBodySelectorFunction:function(responseBody) {
				//console.log("Exchange Rate Response: " + JSON.stringify(responseBody));

				var exchangedCurrencies = ["ARS"];

				if (responseBody.base) {
					var exchangeRates = {};

					for (var i = 0; i < exchangedCurrencies.length; i++) {
						var key = exchangedCurrencies[i];
						if (responseBody['USD']) {
							// If found duped currency units for the same api source then skip all instead of retrieve wrong rates.
							var applicableUnit = currencyUnits.filter(x => x.name === key).length == 1 ? currencyUnits.find(x => x.name === key) : undefined;
							if (applicableUnit) {
								exchangeRates[key.toLowerCase()] = parseFloat(responseBody['USD'][key]).toString();
							}
						}
					}
					return exchangeRates;
				}

				return null;
			}
		}
	],
	blockRewardFunction:function(blockHeight, chain) {
		var eras = [ new Decimal2(2500) ];
		// since we have 2 decimal precision the last halving with a block reward > 0
		// would be the 30th
		for (var i = 1; i < 31; i++) {
			var previous = eras[i - 1];
			eras.push(new Decimal2(previous).dividedBy(2));
		}

		// 2 minutes bloc, 4 years halving period equals to 1.05 milion blocs
		var halvingBlockInterval = (chain == "regtest" ? 150 : 1050000);
		var index = Math.floor(blockHeight / halvingBlockInterval);

		return eras[index];
	}
};
