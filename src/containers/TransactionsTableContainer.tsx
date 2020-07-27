import { WithStyles } from "@material-ui/core";
import Grid from "@material-ui/core/Grid";
import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";
import Typography from "@material-ui/core/Typography";
import { Styles, withStyles } from "@material-ui/styles";
import { withStore } from "@spyna/react-store";
import React from "react";

import ActionLink from "../components/ActionLink";
import ConversionActions from "../components/ConversionActions";
import ConversionStatus from "../components/ConversionStatus";
import { StoreProps } from "../store/store";
import theme from "../theme/theme";
import { initLocalWeb3 } from "../utils/walletUtils";

const styles: Styles<typeof theme, {}> = () => ({
  container: {
    background: "#fff",
    border: "0.5px solid " + theme.palette.divider,
    minHeight: 200,
    height: "100%",
  },
  titleWrapper: {
    paddingBottom: theme.spacing(2),
  },
  actionsCell: {
    minWidth: 150,
  },
  emptyMessage: {
    display: "flex",
    paddingTop: theme.spacing(8),
    justifyContent: "center",
    height: "100%",
  },
});

interface Props extends WithStyles<typeof styles>, StoreProps {}

const TransactionsTableContainer: React.FC<Props> = ({ store, classes }) => {
  const selectedNetwork = store.get("selectedNetwork");
  const transactions = store
    .get("convert.transactions")
    .filter((t) => t.sourceNetworkVersion === selectedNetwork);
  // const localWeb3Address = store.get("localWeb3Address");
  const fsSignature = store.get("fsSignature");

  const signedIn = fsSignature;
  // const hasTransactions = transactions.length > 0;
  const loadingTransactions = store.get("loadingTransactions");
  const error = store.get("walletConnectError");

  const showTransactions =
    signedIn && !loadingTransactions && !error && transactions.length > 0;

  return (
    <div className={classes.container}>
      {/*<div className={classes.titleWrapper}>
            <Typography variant='subtitle1'><b>Conversions</b></Typography>
          </div>*/}
      <Table>
        <TableHead>
          <TableRow>
            <TableCell align="left">Transaction</TableCell>
            <TableCell>Status</TableCell>
            {/*<TableCell align="left">Date</TableCell>*/}
            <TableCell>
              <div className={classes.actionsCell}></div>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {showTransactions &&
            transactions.map((tx, i) => {
              const destAsset = tx.swapReverted
                ? "RENBTC"
                : tx.destAsset.toUpperCase();
              const sourceAsset = tx.sourceAsset.toUpperCase();
              return (
                <TableRow key={i}>
                  <TableCell align="left">
                    <Typography variant="caption">
                      {tx.sourceAmount ? tx.sourceAmount : tx.amount}{" "}
                      {sourceAsset} → {destAsset}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">
                      <ConversionStatus tx={tx} />
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Grid container justify="flex-end">
                      <ConversionActions tx={tx} />
                    </Grid>
                  </TableCell>
                </TableRow>
              );
            })}
        </TableBody>
      </Table>
      <div className={classes.message}>
        {!showTransactions && (
          <div className={classes.emptyMessage}>
            {loadingTransactions ? (
              <Typography variant="caption">Loading transactions...</Typography>
            ) : (
              <React.Fragment>
                {error ? (
                  <Typography variant="caption">
                    Connect failed.{" "}
                    <ActionLink onClick={initLocalWeb3}>Retry</ActionLink>
                  </Typography>
                ) : signedIn && !transactions.length ? (
                  <Typography variant="caption">No transactions</Typography>
                ) : !signedIn ? (
                  <Typography variant="caption">
                    Please{" "}
                    <ActionLink onClick={initLocalWeb3}>
                      connect wallet
                    </ActionLink>{" "}
                    to view transactions
                  </Typography>
                ) : null}
              </React.Fragment>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default withStyles(styles)(withStore(TransactionsTableContainer));
