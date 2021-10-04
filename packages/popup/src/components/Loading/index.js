/**
 * Created by stabila on 2019/7/3.
 */
import React from 'react';
import Button from '@stabilaclick/popup/src/components/Button';
import LoadingGif from 'assets/images/loading_black.gif';

import { injectIntl } from 'react-intl';

import './Loading.scss';

class Loading extends React.Component {
    constructor(props){
        super(props);
    }

    componentDidMount(){
        if(document.getElementById('stabilaLedgerBridge')){
            document.head.removeChild(document.getElementById('stabilaLedgerBridge'));
        }
        const iframe = document.createElement('iframe');
        iframe.id = 'stabilaLedgerBridge';
        iframe.src = 'https://zacharyle.github.io/stabila-ledger-bridge?new='+Math.random();
        document.head.appendChild(iframe);
    }

    render() {
        const {formatMessage} = this.props.intl;
        const {
            show = true,
            title = formatMessage({id: 'CREATION.LEDGER.LOADING'})
        } = this.props;

        return (
            show
                ?
                <div className="loading">
                    <div className="wrap">
                        <div className="title">
                            {title}
                        </div>
                        <img src={LoadingGif} alt=""/>
                        <Button id="BUTTON.CANCEL" onClick={this.props.onClose}/>
                    </div>
                </div>
                :
                null
        );
    }
};

export default injectIntl(Loading);