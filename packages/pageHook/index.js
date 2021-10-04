import EventChannel from '@stabilaclick/lib/EventChannel';
import Logger from '@stabilaclick/lib/logger';
import StabilaWeb from 'stabilaweb';
//import UnitWeb from 'unitweb';

import Utils from '@stabilaclick/lib/utils';
import { CONTRACT_ADDRESS, SIDE_CHAIN_ID, NODE } from '@stabilaclick/lib/constants'
import RequestHandler from './handlers/RequestHandler';
import ProxiedProvider from './handlers/ProxiedProvider';
import UnitWeb from './UnitWeb';
// import UnitWeb from './UnitWeb/js-sdk/src/index';

const logger = new Logger('pageHook');

const pageHook = {
    proxiedMethods: {
        setAddress: false,
        sign: false
    },

    init() {
        this._bindStabilaWeb();
        this._bindEventChannel();
        this._bindEvents();

        this.request('init').then(({ address, node, name, type, phishingList}) => {
            if(address)
                this.setAddress({address,name,type});

            if(node.fullNode)
                this.setNode(node);

            logger.info('StabilaLink initiated');
            const href = window.location.origin;
            const c = phishingList.filter(({url})=>{
                const reg = new RegExp(url);
                return href.match(reg);
            });
            if(c.length && !c[0].isVisit){
                window.location = 'https://www.stabila.click/phishing.html?href='+href;
            }
        }).catch(err => {
            logger.error('Failed to initialise StabilaWeb', err);
        });
    },

    _bindStabilaWeb() {
        if(window.stabilaWeb !== undefined)
            logger.warn('StabilaWeb is already initiated. StabilaLink will overwrite the current instance');

        const stabilaWeb = new StabilaWeb(
            new ProxiedProvider(),
            new ProxiedProvider(),
            new ProxiedProvider()
        );

        const stabilaWeb1 = new StabilaWeb(
            new ProxiedProvider(),
            new ProxiedProvider(),
            new ProxiedProvider()
        );

        const stabilaWeb2 = new StabilaWeb(
            new ProxiedProvider(),
            new ProxiedProvider(),
            new ProxiedProvider()
        );
        const unitWeb = new UnitWeb(
            stabilaWeb1,
            stabilaWeb2,
            //{fullNode:'https://api.stabilagrid.io',solidityNode:'https://api.stabilagrid.io',eventServer:'https://api.stabilagrid.io'},
            //{fullNode:'https://unit.stabilaex.io',solidityNode:'https://unit.stabilaex.io',eventServer:'https://unit.stabilaex.io'},
            //{fullNode:'http://47.252.84.158:8070',solidityNode:'http://47.252.84.158:8071',eventServer:'http://47.252.81.14:8070'},
            //{fullNode:'http://47.252.85.90:8070',solidityNode:'http://47.252.85.90:8071',eventServer:'http://47.252.87.129:8070'},
            CONTRACT_ADDRESS.MAIN,
            CONTRACT_ADDRESS.SIDE,
            SIDE_CHAIN_ID
        );



        stabilaWeb.extension = {}; //add a extension object for black list
        stabilaWeb.extension.setVisited=(href)=>{
            this.setVisited(href);
        };
        this.proxiedMethods = {
            setAddress: stabilaWeb.setAddress.bind(stabilaWeb),
            setMainAddress: unitWeb.mainchain.setAddress.bind(unitWeb.mainchain),
            setSideAddress: unitWeb.sidechain.setAddress.bind(unitWeb.sidechain),
            sign: stabilaWeb.stb.sign.bind(stabilaWeb)
        };

        [ 'setPrivateKey', 'setAddress', 'setFullNode', 'setSolidityNode', 'setEventServer' ].forEach(method => {
            stabilaWeb[ method ] = () => new Error('StabilaLink has disabled this method');
            unitWeb.mainchain[ method ] = () => new Error('StabilaLink has disabled this method');
            unitWeb.sidechain[ method ] = () => new Error('StabilaLink has disabled this method');
        });

        stabilaWeb.stb.sign = (...args) => (
            this.sign(...args)
        );

        unitWeb.mainchain.stb.sign = (...args) => (
            this.sign(...args)
        );
        unitWeb.sidechain.stb.sign = (...args) => (
            this.sign(...args)
        );


        window.unitWeb = unitWeb;
        window.stabilaWeb = stabilaWeb;
    },

    _bindEventChannel() {
        this.eventChannel = new EventChannel('pageHook');
        this.request = RequestHandler.init(this.eventChannel);
    },

    _bindEvents() {
        this.eventChannel.on('setAccount', address => (
            this.setAddress(address)
        ));

        this.eventChannel.on('setNode', node => (
            this.setNode(node)
        ));
    },

    setAddress({address,name,type}) {
        // logger.info('StabilaLink: New address configured');
        if(!stabilaWeb.isAddress(address)){
            stabilaWeb.defaultAddress = {
                hex: false,
                base58: false
            };
            stabilaWeb.ready = false;
        } else {
            this.proxiedMethods.setAddress(address);
            this.proxiedMethods.setMainAddress(address);
            this.proxiedMethods.setSideAddress(address);
            stabilaWeb.defaultAddress.name = name;
            stabilaWeb.defaultAddress.type =  type;
            unitWeb.mainchain.defaultAddress.name = name;
            unitWeb.mainchain.defaultAddress.type = type;
            unitWeb.sidechain.defaultAddress.name = name;
            unitWeb.sidechain.defaultAddress.type = type;
            stabilaWeb.ready = true;
        }

    },

    setNode(node) {
        // logger.info('StabilaLink: New node configured');
        stabilaWeb.fullNode.configure(node.fullNode);
        stabilaWeb.solidityNode.configure(node.solidityNode);
        stabilaWeb.eventServer.configure(node.eventServer);

        unitWeb.mainchain.fullNode.configure(NODE.MAIN.fullNode);
        unitWeb.mainchain.solidityNode.configure(NODE.MAIN.solidityNode);
        unitWeb.mainchain.eventServer.configure(NODE.MAIN.eventServer);

        unitWeb.sidechain.fullNode.configure(NODE.SIDE.fullNode);
        unitWeb.sidechain.solidityNode.configure(NODE.SIDE.solidityNode);
        unitWeb.sidechain.eventServer.configure(NODE.SIDE.eventServer);
    },

    setVisited(href){
        this.request('setVisited', {
            href
        }).then(res => res).catch(err => {
            logger.error('Failed to set visit:', err);
        });
    },

    sign(transaction, privateKey = false, useStabilaHeader = true, callback = false) {
        if(Utils.isFunction(privateKey)) {
            callback = privateKey;
            privateKey = false;
        }

        if(Utils.isFunction(useStabilaHeader)) {
            callback = useStabilaHeader;
            useStabilaHeader = true;
        }

        if(!callback)
            return Utils.injectPromise(this.sign.bind(this), transaction, privateKey, useStabilaHeader);

        if(privateKey)
            return this.proxiedMethods.sign(transaction, privateKey, useStabilaHeader, callback);

        if(!transaction)
            return callback('Invalid transaction provided');

        if(!stabilaWeb.ready)
            return callback('User has not unlocked wallet');
        this.request('sign', {
            transaction,
            useStabilaHeader,
            input: (
                typeof transaction === 'string' ?
                    transaction :
                    transaction.__payload__ ||
                    transaction.raw_data.contract[ 0 ].parameter.value
            )
        }).then(transaction => (
            callback(null, transaction)
        )).catch(err => {
            logger.error('Failed to sign transaction:', err);
            callback(err);
        });
    }
};

pageHook.init();
