import debug from "debug";
import { createClient } from "redis";
import { fileTypeFromBuffer } from 'file-type';
import config from "./config.js";
import utils from "./utils.js";
import tokenApi from "./api/tokenApi.js";
import BeeQueue from 'bee-queue';
import coreApi from "./api/coreApi.js";
import db from '../models/index.js'
import path from 'path';
const __dirname = path.dirname('../');
import moment from "moment";
import fs from 'fs';
import axios from 'axios';
import JSZip from "jszip";
const debugLog = debug("nexexp:queue");
import global from "./global.js";
import {Address, AddressType, GroupIdType, GroupToken, Script} from "libexana-ts";

const tokenProcessQueue = new BeeQueue('tokenProcessQueue',{
	redis: createClient(config.redisUrl),
	activateDelayedJobs: true,
	removeOnSuccess: true
});


tokenProcessQueue.process(3,async (job) => {
	debugLog(`Processing job ${job.id}, token: ${job.data.token}`);
	let token = job.data.token;
	let isNFT = job.data.isNFT
	return new Promise(async function(resolve, reject) {
		let tokenInfo = null;
		const transfers = [];
		let totalSupply = BigInt(0);
		let genesisTxTime = null;
		let circulatingSupply = BigInt(0);
		const result = await coreApi.getTokenGenesis(token);
		let promises = [];
		if(result) {
			tokenInfo = result;

			promises.push(new Promise(function(resolve, reject) {
				tokenApi.getTokenSupply(token).then(function(result) {
					totalSupply = BigInt(result.rawSupply)
					circulatingSupply = BigInt(result.rawSupply)
					resolve();
				}).catch(function(err) {
					debugLog(err);
					reject(err);
				});
			}));

			promises.push(new Promise(function(resolve, reject) {
				coreApi.getRawTransaction(tokenInfo.txid).then(function(tx) {
					if (tx) {
						genesisTxTime = moment.unix(tx.time).format();
					}
					resolve();
				}).catch(function(err) {
					reject(err);
				});
			}));

			Promise.all(promises).then(async function() {

				if(tokenInfo.decimal_places > 0) {
					totalSupply = String(totalSupply).substring(0, String(totalSupply).length - tokenInfo.decimal_places) + "." + String(totalSupply).substring(String(totalSupply).length - tokenInfo.decimal_places);
				}

				totalSupply = utils.addThousandsSeparators(totalSupply)
				let documentInfo = null;

				let parent = null;
				let nftData = null;
				let nftURL = null;
				let nftDataProviderName = null;
				let nftMetadata = null;
				let tokenName = tokenInfo.name
				let tokenTicker = tokenInfo.ticker
				let tokenCollection = null;
				let tokenCollectionId = null;
				let tokenAuthor = null;
				let frontFile = null
				let files = [];

				let groupId = Address.fromString(token)
				if (GroupToken.isSubgroup(token)) {
					// this is asubgroup which contains the parent group id in the first 32 bytes
					parent = new Address(Buffer.from(groupId.data.subarray(0, 32)), groupId.network, AddressType.GroupIdAddress).toString()
				}
				await processDocumentUrl(tokenInfo, documentInfo)
				// If its an NFT lets try and grab the image for it.
				if(isNFT) {
					if(tokenInfo.op_return != null) {

						let opReturnScript = new Script(tokenInfo.op_return)
						if(opReturnScript.chunks.length < 1){
							return;
						}

						if(opReturnScript.getGroupIdType() === GroupIdType.NRC3) {
							// token is a nebula NFT
							const prefix = global.activeBlockchain === "exana" ? "exana:" : "exanatest:";
							const isTestnet = (prefix === "exanatest:");
							if(isTestnet){
								nftURL  = "https://api.testnet.nebula.markets/raw/" + token + '.zip';
								nftDataProviderName = "Nebula Testnet";
							} else {
								nftURL = "https://api.nebula.markets/raw/" + token + '.zip';
								nftDataProviderName = "Nebula";
							}
						} else {
							debugLog("This is the token classifier: " + GroupIdType.NRC3)
							debugLog("This is the op return classifier: " + opReturnScript.getGroupIdType())
						}

					} else {
						// token is a nifty NFT
						nftURL = "https://niftyart.cash/_public/" + token;
						nftDataProviderName = "Nifty Art";
					}
					debugLog(nftURL)
					debugLog(nftDataProviderName)

					try{
						const nftPath = path.join(__dirname, "public", "img", "nfts");
						const nftZipPath = path.join(__dirname, "public", "nfts");
						let zipData = null

						if(!fs.existsSync(nftZipPath + '/'+ token + '.zip'))
						{
							debugLog("downloading NFT file")
							let response = null;
							try {
								response = await axios.get(nftURL, {responseType: 'arraybuffer'});
								zipData = Buffer.from(response.data, 'binary').toString('base64');
								let zip = await JSZip.loadAsync(zipData, {base64: true});
								await zip
									.generateNodeStream({type:'nodebuffer',streamFiles:true})
									.pipe(fs.createWriteStream(nftZipPath + '/'+ token + '.zip'))
									.on('finish', function () {
										// JSZip generates a readable stream with a "end" event,
										// but is piped here in a writable stream which emits a "finish" event.
										debugLog("Saving: " + nftZipPath + '/'+ token + '.zip')
									});
							} catch (e) {
								debugLog("Cant load NFT data: " + e)
							}

						} else {
							debugLog("Reading Stored file")
							zipData = fs.readFileSync(nftZipPath + '/' + token + '.zip', {
								encoding: "base64"
							})

						}

						// if isNFT it parent should not be null.
						// use the parent grpID to get the name of the parent group which
						// is the token collection
						// sanity check parent is not null
						let parentName = null
						if (parent != null)
						{
							try {
								const parentResult = await coreApi.getTokenGenesis(parent);
								parentName = parentResult.name;
							}catch (e) {
								debugLog("Cannot load parent genesis: "+ e)
							}
						}

						nftData = await utils.loadNFTData(zipData, nftDataProviderName);
						tokenName = nftData?.nftMetadata?.name ?? null;
						tokenCollection = parentName ?? null;
						tokenAuthor = nftData?.nftMetadata?.author ?? null;
						nftMetadata = nftData?.nftMetadata ?? null;

						if (!fs.existsSync(nftPath + '/' + token)){
							fs.mkdirSync(nftPath + '/' + token);
						}
						tokenTicker = null;
						for (let i = 0; i < nftData.nftFiles.length; i++) {
							var file = nftData.nftFiles[i]
							if(file.title !== 'Owner') {
								try {
									let b =  Buffer.from(file.image, 'base64');
									const fileType =  await fileTypeFromBuffer(b);
									var filePath = nftPath + '/' + token + '/' + file.title + '.'+ fileType.ext
									fs.writeFileSync(filePath, b);
									let fileStore = {title: file.title, path: filePath, ext: fileType.ext, mime: fileType.mime}
									if((file.title === "Front" || file.title === "Public") && frontFile == null) {
										frontFile = fileStore
									}
									files.push(fileStore)
								} catch(err) {
									debugLog("Cannot write file for token: ", token)
									debugLog("Cannot write file for token: ", err)
								}

							}
						}

					} catch(err){
						debugLog(`cannot load NFT data: ${err}`)
					}

					if(parent && (nftDataProviderName && nftDataProviderName.includes('Nebula'))) {
						const [collectionModel, collectionCreated] = await db.Collection.findOrCreate({
							where: {
								group: parent
							},
							defaults: {
								name: tokenCollection,
								author: tokenAuthor,
								cover_image: frontFile ?? null
							}
						});
						tokenCollectionId = collectionModel.id;
					}

					const series = nftData?.nftMetadata?.collection ?? null;

					if (series && (series !== ' ' || series !== '') &&(nftDataProviderName &&  nftDataProviderName.includes('Nifty'))) {
						const [collectionModel, collectionCreated] = await db.Collection.findOrCreate({
							where: {
								name: series,
								group: parent
							},
							defaults: {
								name: series,
								author: tokenAuthor,
								cover_image: frontFile ?? null
							}
						});
						tokenCollectionId = collectionModel.id;
					}
				}
				let operations = 0;
				let holders = 0;
				try {
					operations = await tokenApi.fetchTokenOperations(token);
				} catch (e) {
					debugLog("Unable to get operations count for token: " + token)
				}
				try {
					holders = await tokenApi.fetchTokenHoldersCount(token);
				} catch (e) {
					debugLog("Unable to get token holders count for token: " + token)
				}


				const [tokenModel, created] = await db.Token.findOrCreate({
					where: { group: token  },
					defaults: {
						group: token,
						parent: parent,
						is_nft: isNFT,
						files: files,
						nft_data: nftMetadata,
						collection: tokenCollection,
						collection_id: tokenCollectionId,
						author: tokenAuthor,
						holders: holders.total,
						transfers: operations.transfer,
						max_supply: totalSupply,
						name: tokenName,
						genesis: tokenInfo,
						ticker: tokenTicker,
						document_info: documentInfo,
						genesis_datetime: genesisTxTime,
						nft_provider_url: nftURL,
						nft_provider_name: nftDataProviderName,
					}
				});

				if(!created && tokenModel) {
					await db.Token.update(
						{
							parent: parent,
							is_nft: isNFT,
							nft_data: nftMetadata,
							collection: tokenCollection,
							author: tokenAuthor,
							holders: holders.total,
							transfers: operations.transfer,
							max_supply: totalSupply,
							name: tokenName,
							genesis: tokenInfo,
							ticker: tokenTicker,
							document_info: documentInfo,
							genesis_datetime: genesisTxTime,
							nft_provider_url: nftURL,
							nft_provider_name: nftDataProviderName,
						},
						{
							where: {
								group: token
							},
						},
					);
				}

				debugLog(`Added Token To Cache: ${token}`)
				await updatePreferenceHeight(tokenInfo)

				resolve(transfers)
			}).catch(function(err) {
				debugLog("db error", err)
				reject(err)
			});
		}
	});
});

async function updatePreferenceHeight(tokenInfo){
	const [preferenceModel, preferenceCreated] = await db.Preference.findOrCreate({
		where: { key: "last_block"  },
		defaults: {
			value: tokenInfo.height,
		}
	})
	if(!preferenceCreated && preferenceModel) {
		if(tokenInfo.height > preferenceModel.value){
			await db.Preference.update(
				{
					value: tokenInfo.height
				},
				{
					where: {
						key: "last_block"
					},
				},
			);
		}
	}
}


async function processDocumentUrl(tokenInfo, documentInfo) {
	if (tokenInfo.document_url && utils.isValidHttpUrl(tokenInfo.document_url)) {
		try {
			let url = tokenInfo.document_url;
			const response = await axios.get(url, {
				headers: {
					"User-Agent": "axios",
					"Content-Type": "application/json"
				}
			});
			const contentType = response.headers["content-type"];
			if (contentType.includes("application/json")) {
				let data = response.data;

				if (data.length > 0) {
					if (typeof data[0] == 'object') {
						documentInfo = {}
						documentInfo['tokenObject'] = data[0];
						documentInfo['signature'] = data[1];

						if (documentInfo['tokenObject']['icon'] != null) {
							if (utils.isValidHttpUrl(documentInfo['tokenObject']['icon'])) {
								const linkParts = documentInfo['tokenObject']['icon'].split('.')
								const extension = linkParts[linkParts.length - 1];
								let fileTypes = ['jpg', 'JPG', 'png', 'PNG', 'svg', 'SVG'];
								if (fileTypes.includes(extension)) {
									documentInfo['icon'] = documentInfo['tokenObject']['icon'];
								}
							} else {
								documentInfo['icon'] = new URL(tokenInfo.document_url).origin + documentInfo['tokenObject']['icon'];
							}
						}
					}
				}
			}
		} catch (err) {
			// utils.logError("Cannot load document URL for token: ", token);
		}
	}
}

tokenProcessQueue.on('error', (err) => {
	debugLog(`A queue error happened: ${err.message}`);
});

tokenProcessQueue.on('succeeded', (job, result) => {
	debugLog(`tokenProcessQueue: Job ${job.id} succeeded with result: ${result}`);
});


export default tokenProcessQueue;
