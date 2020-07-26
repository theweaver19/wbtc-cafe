// eslint-disable jsx-a11y/anchor-is-valid

import { WithStyles } from "@material-ui/core";
import { Styles } from "@material-ui/core/styles/withStyles";
import { withStyles } from "@material-ui/styles";
import React from "react";

import { getStore } from "../services/storeService";
import theme from "../theme/theme";
import {
  completeConvertToEthereum,
  initConvertFromEthereum,
  removeTx,
} from "../utils/txUtils";
import { ExternalLink } from "./ExternalLink";

const styles: Styles<typeof theme, {}> = () => ({
  viewLink: {
    fontSize: 12,
    marginRight: theme.spacing(1),
    textDecoration: "underline",
    cursor: "pointer",
  },
});

interface Props extends WithStyles<typeof styles> {
  tx: any;
}

const ConversionActions = (props: Props) => {
  const { tx, classes } = props;

  const store = getStore();
  const direction = tx.destNetwork === "ethereum" ? "in" : "out";

  return (
    <React.Fragment>
      <div>
        {direction === "in" && tx.sourceTxHash && (
          <ExternalLink
            className={classes.viewLink}
            href={`https://sochain.com/tx/BTC${
              tx.sourceNetworkVersion === "testnet" ? "TEST" : ""
            }/${tx.sourceTxHash}`}
          >
            View BTC TX
          </ExternalLink>
        )}
        {direction === "in" && tx.destTxHash ? (
          <ExternalLink
            className={classes.viewLink}
            href={
              "https://" +
              (tx.destNetworkVersion === "testnet" ? "kovan." : "") +
              "etherscan.io/tx/" +
              tx.destTxHash
            }
          >
            View ETH TX
          </ExternalLink>
        ) : null}
        {direction === "in" && tx.awaiting === "btc-init" && !tx.error && (
          <React.Fragment>
            <a
              className={classes.viewLink}
              onClick={() => {
                // view modal
                store.set("showGatewayModal", true);
                store.set("gatewayModalTx", tx);
              }}
            >
              View Gateway Address
            </a>
            <a
              className={classes.viewLink}
              onClick={() => {
                // are you sure modal
                store.set("showCancelModal", true);
                store.set("cancelModalTx", tx);
              }}
            >
              Cancel
            </a>
          </React.Fragment>
        )}

        {direction === "out" && tx.sourceTxHash ? (
          <ExternalLink
            className={classes.viewLink}
            href={
              "https://" +
              (tx.sourceNetworkVersion === "testnet" ? "kovan." : "") +
              "etherscan.io/tx/" +
              tx.sourceTxHash
            }
          >
            View ETH TX
          </ExternalLink>
        ) : null}
        {direction === "out" && !tx.awaiting && tx.destAddress && (
          <ExternalLink
            className={classes.viewLink}
            href={`https://sochain.com/address/BTC${
              tx.destNetworkVersion === "testnet" ? "TEST" : ""
            }/${tx.destAddress}`}
          >
            View BTC TX
          </ExternalLink>
        )}

        {((tx.error && tx.awaiting === "eth-settle") ||
          tx.awaiting === "eth-init") && (
          <React.Fragment>
            <a
              className={classes.viewLink}
              onClick={() => {
                if (direction === "out") {
                  initConvertFromEthereum(tx);
                } else {
                  completeConvertToEthereum(tx);
                }
              }}
            >
              Submit
            </a>
            {direction === "out" && (
              <a
                className={classes.viewLink}
                onClick={() => {
                  removeTx(tx);
                }}
              >
                Cancel
              </a>
            )}
          </React.Fragment>
        )}

        {!tx.awaiting && !tx.error && (
          <a
            className={classes.viewLink}
            onClick={() => {
              removeTx(tx);
            }}
          >
            Clear
          </a>
        )}

        {direction === "out" && tx.error && tx.sourceTxHash && (
          <a
            className={classes.viewLink}
            onClick={() => {
              removeTx(tx);
            }}
          >
            Clear
          </a>
        )}
      </div>
    </React.Fragment>
  );
};

export default withStyles(styles)(ConversionActions);
