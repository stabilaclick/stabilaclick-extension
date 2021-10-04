import StorageService from '../StorageService';
import randomUUID from 'uuid/v4';
import StabilaWeb from 'stabilaweb';
import UnitWeb from 'unitweb';
import Logger from '@stabilaclick/lib/logger';
import { CONTRACT_ADDRESS,SIDE_CHAIN_ID,NODE } from '@stabilaclick/lib/constants';
import { BigNumber } from 'bignumber.js';

const logger = new Logger('NodeService');

const NodeService = {
    _chains:{
        '_':{
            name:'STABILA',
            default:true
        },
        [ SIDE_CHAIN_ID ]:{
            name:'DAppChain',
            default:false
        }
    },
    _nodes: {
            // 'f0b1e38e-7bee-485e-9d3f-69410bf30682': {
            //     name: 'Mainnet Testnet',
            //     fullNode: 'http://47.252.84.158:8070',
            //     solidityNode: 'http://47.252.84.158:8071',
            //     eventServer: 'http://47.252.81.14:8070',
            //     default: true, // false
            //     chain:'_',
            //     connect: SIDE_CHAIN_ID
            // },
            'f0b1e38e-7bee-485e-9d3f-69410bf30681': {
                name: 'Mainnet',
                fullNode: 'https://api.stabilagrid.io',
                solidityNode: 'https://api.stabilagrid.io',
                eventServer: 'https://api.stabilagrid.io',
                default: true, // false
                chain:'_' ,
                connect: SIDE_CHAIN_ID
            },
            '6739be94-ee43-46af-9a62-690cf0947269': {
                name: 'Testnet Testnet',
                fullNode: 'https://api.testnet.stabilagrid.io',
                solidityNode: 'https://api.testnet.stabilagrid.io',
                eventServer: 'https://api.testnet.stabilagrid.io',
                default: false,
                chain:'_'
            },
            // 'a981e232-a995-4c81-9653-c85e4d05f598':{
            //     name: 'SideChain Testnet',
            //     fullNode: 'http://47.252.85.90:8070',
            //     solidityNode: 'http://47.252.85.90:8071',
            //     eventServer: 'http://47.252.87.129:8070',
            //     default: true,
            //     chain:SIDE_CHAIN_ID
            // },
            'a981e232-a995-4c81-9653-c85e4d05f599':{
                name: 'DappChain',
                fullNode: 'https://unit.stabilaex.io',
                solidityNode: 'https://unit.stabilaex.io',
                eventServer: 'https://unit.stabilaex.io',
                default: true,
                chain: SIDE_CHAIN_ID
            },

    },
    _selectedChain:'_',
    _selectedNode: 'f0b1e38e-7bee-485e-9d3f-69410bf30681',
    _read() {
        logger.info('Reading nodes and chains from storage');

        const {
            chainList = {},
            selectedChain = false
        } = StorageService.chains;
        this._chains = {...this._chains,...chainList};

        const {
            nodeList = {},
            selectedNode = false
        } = StorageService.nodes;


        this._nodes = {
            ...this._nodes,
            ...nodeList,
        };


        this._nodes = Object.entries(this._nodes).map(([nodeId, node])=>{
            if(!node.hasOwnProperty('chain')){
                node.chain = '_';
            }
            return [nodeId, node];
        }).reduce((accumulator, currentValue)=>{accumulator[currentValue[0]]=currentValue[1];return accumulator;},{});

        if(selectedChain)
            this._selectedChain = selectedChain;

        if(selectedNode)
            this._selectedNode = selectedNode;
    },

    init() {
        this._read();
        this._updateStabilaWeb();
    },

    _updateStabilaWeb(skipAddress = false) {
        const {
            fullNode,
            solidityNode,
            eventServer
        } = this.getCurrentNode();

        this.unitWeb = new UnitWeb(
            //{fullNode:'https://api.stabilagrid.io',solidityNode:'https://api.stabilagrid.io',eventServer:'https://api.stabilagrid.io'},
            //{fullNode:'https://unit.stabilaex.io',solidityNode:'https://unit.stabilaex.io',eventServer:'https://unit.stabilaex.io'},
            NODE.MAIN,
            NODE.SIDE,
            CONTRACT_ADDRESS.MAIN,
            CONTRACT_ADDRESS.SIDE,
            SIDE_CHAIN_ID
        );

        this.stabilaWeb = new StabilaWeb(
            fullNode,
            solidityNode,
            eventServer
        );
        if(!skipAddress)
            this.setAddress();
    },

    setAddress() {
        if(!this.stabilaWeb)
            this._updateStabilaWeb();

        if(!StorageService.selectedAccount)
            return this._updateStabilaWeb(true);

        this.stabilaWeb.setAddress(
            StorageService.selectedAccount
        );
    },

    save() {

        Object.entries(this._nodes).forEach(([ nodeID, node ]) => (
            StorageService.saveNode(nodeID, node)
        ));

        Object.entries(this._chains).forEach(( [chainId, chain ])=>{
            StorageService.saveChain(chainId, chain)
        });

        StorageService.selectChain(this._selectedChain);
        StorageService.selectNode(this._selectedNode);
        this._updateStabilaWeb();
    },

    getNodes() {
        return {
            nodes: this._nodes,
            selected: this._selectedNode
        };
    },

    getChains() {
        return {
            chains: this._chains,
            selected: this._selectedChain
        };
    },

    getCurrentNode() {
        return this._nodes[ this._selectedNode ];
    },

    selectNode(nodeID) {
        StorageService.selectNode(nodeID);

        this._selectedNode = nodeID;
        this._updateStabilaWeb();
    },

    deleteNode(nodeID) {
        StorageService.deleteNode(nodeID);
        delete this._nodes[nodeID];
        if(nodeID === this._selectedNode) {
            const nodeId = Object.entries(this._nodes).filter(([nodeId,node])=>node.default && node.chain === this._selectedChain)[0][0];
            this.selectNode(nodeId);
            return nodeId;
        }else{
            return false;
        }
    },

    selectChain(chainId) {
        StorageService.selectChain(chainId);
        this._selectedChain = chainId;
        this._updateStabilaWeb();
    },

    addNode(node) {
        const nodeID = randomUUID();

        this._nodes[ nodeID ] = {
            ...node,
            default: false
        };
        this.save();
        return nodeID;
    },

    async getSmartToken(address) {
        try {
            let balance;
            const contract = await this.stabilaWeb.contract().at(address);
            if(!contract.name && !contract.symbol && !contract.decimals)
                return false;
            const d = await contract.decimals().call();
            const name = await contract.name().call();
            const symbol = await contract.symbol().call();
            const decimals = typeof d === 'object' && d._decimals ? d : new BigNumber(d).toNumber();
            const number = await contract.balanceOf(address).call();
            if (number.balance) {
                balance = new BigNumber(number.balance).toString();
            } else {
                balance = new BigNumber(number).toString();
            }

            return {
                name: typeof name === 'object' ? name._name: name,
                symbol: typeof symbol === 'object' ? symbol._symbol: symbol,
                decimals: typeof decimals === 'object' ? decimals._decimals: decimals,
                balance
            };
        } catch(ex) {
            logger.error(`Failed to fetch token ${ address }:`, ex);
            return false;
        }
    }
};

export default NodeService;
