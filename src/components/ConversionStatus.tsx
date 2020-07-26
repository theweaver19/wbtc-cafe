import { WithStyles } from "@material-ui/core";
import { Styles } from "@material-ui/core/styles/withStyles";
import Typography from "@material-ui/core/Typography";
import { withStyles } from "@material-ui/styles";
import React from "react";

import { Transaction } from "../types/transaction";

const styles: Styles<{}, {}> = () => ({});

interface Props extends WithStyles<typeof styles> {
  tx: Transaction;
}

const ConversionStatus = (props: Props) => {
  const { tx } = props;

  // const direction = tx.destNetwork === "ethereum" ? "in" : "out";
  const targetBtcConfs = tx.sourceNetworkVersion === "testnet" ? 2 : 6;
  const targetEthConfs = tx.sourceNetworkVersion === "testnet" ? 13 : 30;

  return (
    <React.Fragment>
      {tx.destNetwork === "ethereum" ? (
        <Typography variant="caption">
          {tx.awaiting === "btc-init" ? (
            <span>{`Waiting for BTC to be sent`}</span>
          ) : null}
          {tx.awaiting === "btc-settle" ? (
            <span>
              {`BTC transaction confirming (${
                tx.btcConfirmations === undefined || tx.btcConfirmations < 0
                  ? "..."
                  : tx.btcConfirmations
              }/${targetBtcConfs} complete)`}
            </span>
          ) : null}
          {tx.awaiting === "ren-settle" ? (
            <span>{`Submitting to RenVM`}</span>
          ) : null}
          {tx.awaiting === "eth-init" ? (
            <span>{`Submit to Ethereum`}</span>
          ) : null}
          {tx.awaiting === "eth-settle" ? (
            <span>
              {tx.error ? `Submit to Ethereum` : `Submitting to Ethereum`}
            </span>
          ) : null}
          {!tx.awaiting ? <span>{`Complete`}</span> : null}
        </Typography>
      ) : (
        <Typography variant="caption">
          {tx.awaiting === "eth-settle" ? (
            <span>
              {tx.sourceTxHash
                ? tx.error
                  ? `Transaction Failed`
                  : `Transaction confirming (${
                      tx.btcConfirmations === undefined ||
                      tx.btcConfirmations < 0
                        ? "..."
                        : tx.sourceTxConfs
                    }/${targetEthConfs} complete)`
                : `Submit to Ethereum`}
              {/*tx.error ? (tx.sourceTxHash ? `Transaction Failed` : `Submit to Ethereum`) : `Transaction confirming (${tx.sourceTxConfs}/${targetEthConfs} complete)`*/}
            </span>
          ) : null}
          {tx.awaiting === "ren-settle" ? (
            <span>{`Submitting to RenVM`}</span>
          ) : null}
          {!tx.awaiting ? <span>{`Complete`}</span> : null}
        </Typography>
      )}
    </React.Fragment>
  );
};

export default withStyles(styles)(ConversionStatus);
