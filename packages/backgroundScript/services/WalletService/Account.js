import StorageService from '../StorageService';
import StabilaWeb from 'stabilaweb';
import Logger from '@stabilaclick/lib/logger';
import Utils from '@stabilaclick/lib/utils';
import NodeService from '../NodeService';

import { BigNumber } from 'bignumber.js';

import {
    ACCOUNT_TYPE,
    CONTRACT_ADDRESS,
    FEE,
    TOP_TOKEN,
    API_URL
} from '@stabilaclick/lib/constants';
import axios from 'axios';

BigNumber.config({ EXPONENTIAL_AT: [-20, 30] });
const logger = new Logger('WalletService/Account');

class Account {
    constructor(accountType, importData, accountIndex = 0) {
        this.type = accountType;
        this.accountIndex = accountIndex;
        this.address = false;
        this.name = false;
        this.updatingTransactions = false;
        this.selectedBankRecordId = 0;
        this.dealCurrencyPage = 0;
        this.ucr = 0;
        this.ucrUsed = 0;
        this.balance = 0;
        this.cdedBalance = 0;
        this.netUsed = 0;
        this.netLimit = 0;
        this.totalUcrWeight = 0; //totalUcrWeight
        this.TotalUcrLimit = 0; //TotalUcrLimit
        this.lastUpdated = 0;
        this.asset = 0;
        this.ignoredTransactions = [];
        this.transactions = {};
        this.airdropInfo = {};
        this.transactionDetail = {};
        this.tokens = {
            basic: {},
            smart: {}
        };
        this.stbAddress = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
        // this.tokens.smart[ CONTRACT_ADDRESS.USDT ] = {
        //     abbr: 'USDT',
        //     name: 'Tether USD',
        //     decimals: 6,
        //     tokenId: CONTRACT_ADDRESS.USDT,
        //     balance: 0,
        //     price: 0
        // };
        if (accountType == ACCOUNT_TYPE.MNEMONIC) {
            this._importMnemonic(importData);
        } else {
            this._importPrivateKey(importData);
        }
        this.loadCache();
    }

    static generateAccount() {
        const mnemonic = Utils.generateMnemonic();

        return new Account(
            ACCOUNT_TYPE.MNEMONIC,
            mnemonic
        );
    }

    _importMnemonic(mnemonic) {
        if (!Utils.validateMnemonic(mnemonic)) {
            throw new Error('INVALID_MNEMONIC');
        }

        this.mnemonic = mnemonic;

        const {
            privateKey,
            address
        } = this.getAccountAtIndex(this.accountIndex);

        this.privateKey = privateKey;
        this.address = address;
    }

    _importPrivateKey(privateKey) {
        try {
            if (privateKey.match(/^T/) && StabilaWeb.isAddress(privateKey)) {
                this.privateKey = null;
                this.address = privateKey;
            } else {
                this.privateKey = privateKey;
                this.address = StabilaWeb.address.fromPrivateKey(privateKey);
            }
        } catch (ex) { // eslint-disable-line
            throw new Error('INVALID_PRIVATE_KEY');
        }
    }

    getAccountAtIndex(index = 0) {
        if (this.type !== ACCOUNT_TYPE.MNEMONIC) {
            throw new Error('Deriving account keys at a specific index requires a mnemonic account');
        }

        return Utils.getAccountAtIndex(
            this.mnemonic,
            index
        );
    }

    loadCache() {
        if (!StorageService.hasAccount(this.address)) {
            return logger.warn('Attempted to load cache for an account that does not exist');
        }

        const {
            type,
            name,
            balance,
            cdedBalance,
            totalUcrWeight,
            TotalUcrLimit,
            transactions,
            tokens,
            netLimit,
            netUsed,
            ucr,
            ucrUsed,
            lastUpdated,
            asset
        } = StorageService.getAccount(this.address);

        // Old TRC10 structure are no longer compatible
        //tokens.basic = {};

        // Remove old token transfers so they can be fetched again
        Object.keys(this.transactions).forEach(txID => {
            const transaction = this.transactions[txID];

            if (transaction.type !== 'TransferAssetContract') {
                return;
            }

            if (transaction.tokenID) {
                return;
            }

            delete this.transactions[txID];
        });

        this.type = type;
        this.name = name;
        this.balance = balance;
        this.cdedBalance = cdedBalance;
        this.totalUcrWeight = totalUcrWeight;
        this.TotalUcrLimit = TotalUcrLimit;
        this.transactions = transactions;
        this.tokens = tokens;
        this.ucr = ucr;
        this.ucrUsed = ucrUsed;
        this.netLimit = netLimit;
        this.netUsed = netUsed;
        this.lastUpdated = lastUpdated;
        this.asset = asset;
        this.hash = '';
    }

    matches(accountType, importData) {
        if (this.type !== accountType) {
            return false;
        }

        if (accountType == ACCOUNT_TYPE.MNEMONIC && this.mnemonic === importData) {
            return true;
        }

        if (accountType == ACCOUNT_TYPE.PRIVATE_KEY && this.privateKey === importData) {
            return true;
        }

        return false;
    }

    reset() {
        this.balance = 0;
        this.cdedBalance = 0;
        this.ucr = 0;
        this.ucrUsed = 0;
        this.netUsed = 0;
        this.transactions = {};
        this.ignoredTransactions = [];
        this.netLimit = 0;
        this.asset = 0;

        /*
        Object.keys(this.tokens.smart).forEach(address => (
             this.tokens.smart[ address ].balance = 0
         ));
         */
        this.tokens.smart = {};
        this.tokens.basic = {};
    }

    /** update data of an account
     * basicTokenPriceList  trc10token price list(source from stbmarket)
     * smartTokenPriceList  trc20token price list(source from stbmarket)
     * usdtPrice            price of usdt
     **/
    async update(basicTokenPriceList = [], smartTokenPriceList = [], usdtPrice = 0) {

        if (!StorageService.allTokens[NodeService._selectedChain === '_' ? 'mainchain' : 'sidechain'].length) return;
        const selectedChain = NodeService._selectedChain;
        const { address } = this;
        logger.info(`Requested update for ${ address }`);
        const { data: { data: smartTokens } } = await axios.get(`${API_URL}/api/wallet/trc20_info`, {
            headers: { chain: selectedChain === '_' ? 'MainChain' : 'DAppChain' },
            params: { address }
        }).catch(e => {
            return { data: { data: [] } };
        });
        try {
            const node = NodeService.getNodes().selected;
            //if (node === 'f0b1e38e-7bee-485e-9d3f-69410bf30681') {
            const account = await NodeService.stabilaWeb.stb.getUnconfirmedAccount(address);

            if (!account.address) {
                logger.info(`Account ${address} does not exist on the network`);
                this.reset();
                return true;
            }
            const addSmartTokens = Object.entries(this.tokens.smart).filter(([tokenId, token]) => !token.hasOwnProperty('abbr'));
            for (const [tokenId, token] of addSmartTokens) {
                const contract = await NodeService.stabilaWeb.contract().at(tokenId).catch(e => false);
                if (contract) {
                    let balance;
                    const number = await contract.balanceOf(address).call();
                    if (number.balance) {
                        balance = new BigNumber(number.balance).toString();
                    } else {
                        balance = new BigNumber(number).toString();
                    }
                    if (typeof token.name === 'object' || (!token.decimals)) {
                        const token2 = await NodeService.getSmartToken(tokenId).catch(err => {
                            throw new Error(`get token ${tokenId} info fail`);
                        });
                        this.tokens.smart[tokenId] = token2;
                    }
                    this.tokens.smart[tokenId].balance = balance;
                    this.tokens.smart[tokenId].price = 0;
                } else {
                    this.tokens.smart[tokenId].balance = 0;
                    this.tokens.smart[tokenId].price = 0;
                }
                this.tokens.smart[tokenId].isLocked = token.hasOwnProperty('isLocked') ? token.isLocked : false;
            }

            this.cdedBalance = (account.cded && account.cded[0]['cded_balance'] || 0) + (account['account_resource']['cded_balance_for_ucr'] && account['account_resource']['cded_balance_for_ucr']['cded_balance'] || 0) + (account['delegated_cded_balance_for_bandwidth'] || 0) + (account['account_resource']['delegated_cded_balance_for_ucr'] || 0);
            this.balance = account.balance || 0;
            const filteredTokens = (account.assetV2 || []).filter(({ value }) => value >= 0);
            for (const { key, value } of filteredTokens) {
                let token = this.tokens.basic[key] || false;
                const filter = basicTokenPriceList.length ? basicTokenPriceList.filter(({ first_token_id }) => first_token_id === key) : [];
                const trc20Filter = smartTokenPriceList.length ? smartTokenPriceList.filter(({ fTokenAddr, sTokenAddr }) => key === fTokenAddr && sTokenAddr === this.stbAddress) : [];
                let { precision = 0, price } = filter.length ? filter[0] : (trc20Filter.length ? {
                    price: trc20Filter[0].price,
                    precision: trc20Filter[0].sPrecision
                } : { price: 0, precision: 0 });
                price = price / Math.pow(10, precision);
                if (node === 'f0b1e38e-7bee-485e-9d3f-69410bf30681' || node === 'a981e232-a995-4c81-9653-c85e4d05f599') {
                    if (StorageService.allTokens[NodeService._selectedChain === '_' ? 'mainchain' : 'sidechain'].filter(({ tokenId }) => tokenId === key).length === 0) return;
                    const {
                        name = 'STB',
                        abbr = 'STB',
                        decimals = 6,
                        imgUrl = false
                    } = StorageService.allTokens[NodeService._selectedChain === '_' ? 'mainchain' : 'sidechain'].filter(({ tokenId }) => tokenId === key)[0];
                    token = {
                        balance: 0,
                        name,
                        abbr,
                        decimals,
                        imgUrl,
                        isLocked: token.hasOwnProperty('isLocked') ? token.isLocked : false
                    };
                    this.tokens.basic[key] = {
                        ...token,
                        balance: value,
                        price
                    };
                } else {
                    if ((!token && !StorageService.tokenCache.hasOwnProperty(key))) {
                        await StorageService.cacheToken(key);
                    }

                    if (StorageService.tokenCache.hasOwnProperty(key)) {
                        const {
                            name,
                            abbr,
                            decimals,
                            imgUrl = false
                        } = StorageService.tokenCache[key];

                        token = {
                            balance: 0,
                            name,
                            abbr,
                            decimals,
                            imgUrl
                        };
                    }
                    this.tokens.basic[key] = {
                        ...token,
                        balance: value,
                        price
                    };

                }
            }
            //const smartTokens = account.trc20token_balances.filter(v => v.balance >= 0);
            const sTokens = smartTokens.map(({ tokenAddress }) => tokenAddress);
            Object.entries(this.tokens.smart).forEach(([tokenId, token]) => {
                if (!sTokens.includes(tokenId) && token.hasOwnProperty('abbr')) {
                    delete this.tokens.smart[tokenId];
                }
            });
            for (let { tokenAddress, logoUrl = false, decimals = 6, isMapping, name, shortName, balance } of smartTokens) {
                let token = this.tokens.smart[tokenAddress] || false;
                const filter = smartTokenPriceList.filter(({ fTokenAddr, sTokenAddr }) => fTokenAddr === tokenAddress && sTokenAddr === this.stbAddress);
                const price = filter.length ? new BigNumber(filter[0].price).shiftedBy(-decimals).toString() : 0;

                token = {
                    price: 0,
                    balance: 0,
                    name,
                    abbr: shortName,
                    decimals,
                    imgUrl: logoUrl,
                    isLocked: token.hasOwnProperty('isLocked') ? token.isLocked : false,
                    isMapping
                };

                this.tokens.smart[tokenAddress] = {
                    ...token,
                    price: tokenAddress === CONTRACT_ADDRESS.USDT ? usdtPrice : price,
                    balance,
                    chain: selectedChain
                };
                //this.tokens.smart[ tokenAddress ] = !TOP_TOKEN[selectedChain === '_' ? 'mainchain':'sidechain'].includes(tokenAddress) ? {...this.tokens.smart[ tokenAddress ],chain:selectedChain} : this.tokens.smart[ tokenAddress ];
                //console.log(tokenAddress, this.tokens.smart[ tokenAddress ]);
            }
            //} else {
            // const account = await NodeService.stabilaWeb.stb.getUnconfirmedAccount(address);
            // if (!account.address) {
            //     logger.info(`Account ${address} does not exist on the network`);
            //     this.reset();
            //     return true;
            // }
            // const filteredTokens = (account.assetV2 || []).filter(({ value }) => {
            //     return value > 0;
            // });
            // if (filteredTokens.length > 0) {
            //     for (const { key, value } of filteredTokens) {
            //         let token = this.tokens.basic[ key ] || false;
            //         const filter = basicTokenPriceList.length ? basicTokenPriceList.filter(({ first_token_id }) => first_token_id === key):[];
            //         const trc20Filter = smartTokenPriceList.length ? smartTokenPriceList.filter(({ fTokenAddr }) => key === fTokenAddr) : [];
            //         let { precision = 0, price } = filter.length ? filter[ 0 ] : (trc20Filter.length ? {
            //             price: trc20Filter[ 0 ].price,
            //             precision: trc20Filter[ 0 ].sPrecision
            //         } : { price: 0, precision: 0 });
            //         price = price / Math.pow(10, precision);
            //         if ((!token && !StorageService.tokenCache.hasOwnProperty(key)))
            //             await StorageService.cacheToken(key);
            //
            //         if (StorageService.tokenCache.hasOwnProperty(key)) {
            //             const {
            //                 name,
            //                 abbr,
            //                 decimals,
            //                 imgUrl = false
            //             } = StorageService.tokenCache[ key ];
            //
            //             token = {
            //                 balance: 0,
            //                 name,
            //                 abbr,
            //                 decimals,
            //                 imgUrl
            //             };
            //         }
            //         this.tokens.basic[ key ] = {
            //             ...token,
            //             balance: value,
            //             price
            //         };
            //     }
            // } else {
            //     this.tokens.basic = {};
            // }
            // //this.tokens.smart = {};
            // const addSmartTokens = Object.entries(this.tokens.smart).filter(([tokenId, token]) => !token.hasOwnProperty('abbr') );
            // for (const [tokenId, token] of addSmartTokens) {
            //     const contract = await NodeService.stabilaWeb.contract().at(tokenId).catch(e => false);
            //     if (contract) {
            //         let balance;
            //         const number = await contract.balanceOf(address).call();
            //         if (number.balance) {
            //             balance = new BigNumber(number.balance).toString();
            //         } else {
            //             balance = new BigNumber(number).toString();
            //         }
            //         if (typeof token.name === 'object') {
            //             const token2 = await NodeService.getSmartToken(tokenId);
            //             this.tokens.smart[ tokenId ] = token2;
            //         } else {
            //             this.tokens.smart[ tokenId ] = token;
            //         }
            //         this.tokens.smart[ tokenId ].imgUrl = false;
            //         this.tokens.smart[ tokenId ].balance = balance;
            //         this.tokens.smart[ tokenId ].price = 0;
            //     } else {
            //         this.tokens.smart[ tokenId ].balance = 0;
            //         this.tokens.smart[ tokenId ].price = 0;
            //     }
            // }
            // this.balance = account.balance || 0;
            // }
            let totalOwnStbCount = new BigNumber(this.balance + this.cdedBalance).shiftedBy(-6);
            Object.entries({ ...this.tokens.basic, ...this.tokens.smart }).map(([tokenId, token]) => {
                if (token.price !== 0 && !token.isLocked) {
                    const prices = StorageService.prices;
                    const price = tokenId === CONTRACT_ADDRESS.USDT ? token.price / prices.priceList[prices.selected] : token.price;
                    totalOwnStbCount = totalOwnStbCount.plus(new BigNumber(token.balance).shiftedBy(-token.decimals).multipliedBy(price));
                }
            });
            this.asset = totalOwnStbCount.toNumber();
            this.lastUpdated = Date.now();
            await Promise.all([
                this.updateBalance(),
            ]);
            logger.info(`Account ${address} successfully updated`);
            Object.keys(StorageService.getAccounts()).includes(this.address) && this.save();
        } catch (error) {
            logger.error(`update account ${this.address} fail`, error);
        }
        return true;
    }

    async updateBalance() {
        const { address } = this;
        const { UcrLimit = 0, UcrUsed = 0, freeNetLimit, NetLimit = 0, freeNetUsed = 0, NetUsed = 0, TotalUcrWeight, TotalUcrLimit } = await NodeService.stabilaWeb.stb.getAccountResources(address);
        this.ucr = UcrLimit;
        this.ucrUsed = UcrUsed;
        this.netLimit = freeNetLimit + NetLimit;
        this.netUsed = NetUsed + freeNetUsed;
        this.totalUcrWeight = TotalUcrWeight;
        this.TotalUcrLimit = TotalUcrLimit;
    }

    async addSmartToken({ address, name, decimals, symbol }) {
        logger.info(`Adding TRC20 token '${ address }' ${ name } (${ symbol }) to account '${ this.address }'`);

        let balance = 0;

        try {
            const contract = await NodeService.stabilaWeb.contract().at(address);
            const balanceObj = await contract.balanceOf(this.address).call();

            const bn = new BigNumber(balanceObj.balance || balanceObj);

            if (bn.isNaN()) {
                balance = '0';
            } else {
                balance = bn.toString();
            }
        } catch (e) {
            logger.error(`add smart token ${address} ${name} fail`, e);
        }

        this.tokens.smart[address] = {
            balance,
            decimals,
            symbol,
            name
        };

        return this.save();
    }

    getDetails() {
        return {
            tokens: this.tokens,
            type: this.type,
            name: this.name,
            address: this.address,
            balance: this.balance,
            cdedBalance: this.cdedBalance,
            totalUcrWeight: this.totalUcrWeight,
            TotalUcrLimit: this.TotalUcrLimit,
            ucr: this.ucr,
            ucrUsed: this.ucrUsed,
            netLimit: this.netLimit,
            netUsed: this.netUsed,
            transactions: this.transactions,
            lastUpdated: this.lastUpdated,
            selectedBankRecordId: this.selectedBankRecordId,
            dealCurrencyPage: this.dealCurrencyPage,
            airdropInfo: this.airdropInfo,
            transactionDetail: this.transactionDetail
        };
    }

    export() {
        return JSON.stringify(this);
    }

    save() {
        StorageService.saveAccount(this);
    }

    async sign(transaction, stabilaWeb = NodeService.stabilaWeb) {

        if (!this.privateKey) {
            return 'CREATION.LEDGER.ALERT.BODY';
        }
        const signedTransaction = stabilaWeb.stb.sign(
            transaction,
            this.privateKey
        );

        return await signedTransaction;
    }

    async sendStb(recipient, amount) {
        const selectedChain = NodeService._selectedChain;
        try {
            if (selectedChain === '_') {
                const transaction = await NodeService.stabilaWeb.transactionBuilder.sendStb(
                    recipient,
                    amount
                );

                await NodeService.stabilaWeb.stb.sendRawTransaction(
                    await this.sign(transaction)
                ).then(() => true).catch(err => Promise.reject(
                    'Failed to broadcast transaction'
                ));
                return Promise.resolve(transaction.txID);
            } else {
                const { transaction } = await NodeService.unitWeb.sidechain.stb.sendTransaction(recipient, amount, { privateKey: this.privateKey });
                return Promise.resolve(transaction.txID);
            }
        } catch (ex) {
            logger.error('Failed to send STB:', ex);
            return Promise.reject(ex);
        }
    }

    async sendBasicToken(recipient, amount, token) {
        const selectedChain = NodeService._selectedChain;
        try {
            if (selectedChain === '_') {
                const transaction = await NodeService.stabilaWeb.transactionBuilder.sendToken(
                    recipient,
                    amount,
                    token
                );

                await NodeService.stabilaWeb.stb.sendRawTransaction(
                    await this.sign(transaction)
                ).then(() => true).catch(err => Promise.reject(
                    'Failed to broadcast transaction'
                ));
                return Promise.resolve(transaction.txID);
            } else {
                const { transaction } = await NodeService.unitWeb.sidechain.stb.sendToken(recipient, amount, token, { privateKey: this.privateKey });
                return Promise.resolve(transaction.txID);
            }
        } catch (ex) {
            logger.error('Failed to send basic token:', ex);
            return Promise.reject(ex);
        }
    }

    async sendSmartToken(recipient, amount, token) {
        const selectedChain = NodeService._selectedChain;
        try {
            if (selectedChain === '_') {
                const contract = await NodeService.stabilaWeb.contract().at(token);
                const transactionId = await contract.transfer(recipient, amount).send(
                    { feeLimit: 10 * Math.pow(10, 6) },
                    this.privateKey
                );
                return Promise.resolve(transactionId);
            } else {
                const sidechain = NodeService.unitWeb.sidechain;
                const { transaction } = await NodeService.stabilaWeb.transactionBuilder.triggerSmartContract(StabilaWeb.address.toHex(token), 'transfer(address,uint256)', { feeLimit: 1000000 }, [{
                    'type': 'address',
                    'value': recipient
                }, { 'type': 'uint256', 'value': amount }]);
                const signTransaction = await sidechain.stb.sign(transaction, this.privateKey);
                await sidechain.stb.sendRawTransaction(signTransaction);
                return Promise.resolve(transaction.txID);
            }
        } catch (ex) {
            logger.error('Failed to send smart token:', ex);
            return Promise.reject(ex);
        }
    }

    async depositStb(amount) {
        try {
            const txId = await NodeService.unitWeb.depositStb(amount, FEE.DEPOSIT_FEE, FEE.FEE_LIMIT, {}, this.privateKey);
            return Promise.resolve(txId);
        } catch (ex) {
            logger.error('Failed to send STB:', ex);
            return Promise.reject(ex);
        }
    }

    async withdrawStb(amount) {
        try {
            const txId = await NodeService.unitWeb.withdrawStb(amount, FEE.WITHDRAW_FEE, FEE.FEE_LIMIT, {}, this.privateKey);
            return Promise.resolve(txId);
        } catch (ex) {
            logger.error('Failed to send STB:', ex);
            return Promise.reject(ex);
        }
    }

    async depositTrc10(id, amount) {
        try {
            const txId = await NodeService.unitWeb.depositTrc10(id, amount, FEE.DEPOSIT_FEE, FEE.FEE_LIMIT, {}, this.privateKey);
            return Promise.resolve(txId);
        } catch (ex) {
            logger.error('Failed to send STB:', ex);
            return Promise.reject(ex);
        }
    }

    async withdrawTrc10(id, amount) {
        try {
            const txId = await NodeService.unitWeb.withdrawTrc10(id, amount, FEE.WITHDRAW_FEE, FEE.FEE_LIMIT, {}, this.privateKey);
            return Promise.resolve(txId);
        } catch (ex) {
            logger.error('Failed to send STB:', ex);
            return Promise.reject(ex);
        }
    }

    async depositTrc20(id, amount) {
        try {
            const approve = await NodeService.unitWeb.approveTrc20(amount, FEE.FEE_LIMIT, id, {}, this.privateKey);
            if (approve) {
                const txId = await NodeService.unitWeb.depositTrc20(amount, FEE.DEPOSIT_FEE, FEE.FEE_LIMIT, id, {}, this.privateKey);
                return Promise.resolve(txId);
            } else {
                return Promise.resolve('failed');
            }
        } catch (ex) {
            logger.error('Failed to send STB:', ex);
            return Promise.reject(ex);
        }
    }

    async withdrawTrc20(id, amount) {
        try {

            const txId = await NodeService.unitWeb.withdrawTrc20(amount, FEE.WITHDRAW_FEE, FEE.FEE_LIMIT, id, {}, this.privateKey);
            return Promise.resolve(txId);

        } catch (ex) {
            logger.error('Failed to send STB:', ex);
            return Promise.reject(ex);
        }
    }
}

export default Account;
