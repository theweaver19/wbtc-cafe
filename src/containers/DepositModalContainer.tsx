import { WithStyles } from "@material-ui/core";
import Backdrop from "@material-ui/core/Backdrop";
import Button from "@material-ui/core/Button";
import Checkbox from "@material-ui/core/Checkbox";
import Divider from "@material-ui/core/Divider";
import Fade from "@material-ui/core/Fade";
import FormControlLabel from "@material-ui/core/FormControlLabel";
import Grid from "@material-ui/core/Grid";
import Modal from "@material-ui/core/Modal";
import SnackbarContent from "@material-ui/core/SnackbarContent";
import { Styles } from "@material-ui/core/styles/withStyles";
import Typography from "@material-ui/core/Typography";
import { withStyles } from "@material-ui/styles";
import { withStore } from "@spyna/react-store";
import classNames from "classnames";
import React, { useState } from "react";

import { StoreProps } from "../store/store";
import theme from "../theme/theme";
import { initConvertToEthereum } from "../utils/txUtils";
import { NAME_MAP } from "../utils/walletUtils";

const styles: Styles<typeof theme, {}> = () => ({
  modal: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing(2),
    [theme.breakpoints.down("xs")]: {
      overflowY: "scroll",
      overflowX: "hidden",
      alignItems: "flex-start",
    },
  },
  modalContent: {
    backgroundColor: "#fff",
    width: 360,
    maxWidth: "100%",
    padding: theme.spacing(2),
  },
  signInInput: {
    width: "100%",
  },
  title: {
    display: "flex",
    alignItems: "center",
    marginBottom: theme.spacing(2),
    fontWeight: "bold",
  },
  arrow: {
    width: 30,
  },
  subtitle: {
    marginTop: theme.spacing(4),
    marginBottom: theme.spacing(3),
  },
  divider: {
    marginTop: theme.spacing(1),
    marginBottom: theme.spacing(1),
  },
  dividerTotal: {
    marginTop: theme.spacing(1),
    marginBottom: theme.spacing(1),
  },
  showButton: {
    marginTop: theme.spacing(4),
  },
  snackbar: {
    boxShadow: "none",
    backgroundColor: "#fb8c00",
    minWidth: "auto",
    marginTop: theme.spacing(3),
    "& svg": {
      color: "#fff",
    },
  },
  connectWalletPrompt: {
    padding: theme.spacing(1),
    borderRadius: theme.shape.borderRadius,
    "& img": {
      height: 35,
      width: "auto",
      marginRight: theme.spacing(1),
    },
  },
  receiptTitle: {
    fontSize: 14,
  },
  receiptAmount: {
    textAlign: "right",
    fontSize: 14,
  },
  total: {
    fontWeight: "bold",
  },
  disabled: {
    opacity: 0.5,
    cursor: "normal",
    pointerEvents: "none",
  },
  walletOption: {
    padding: theme.spacing(2),
    borderRadius: 5,
    "&:hover": {
      backgroundColor: "rgba(0, 0, 0, 0.02)",
      cursor: "pointer",
    },
  },
  disclosure: {
    "& span": {
      fontSize: 14,
    },
  },
  netTitle: {
    fontSize: 14,
  },
  netAmount: {
    fontSize: 14,
    textAlign: "right",
  },
});

interface Props extends WithStyles<typeof styles>, StoreProps {}

const DepositModalContainer: React.FC<Props> = ({ store, classes }) => {
  const [depositDisclosureChecked, setDepositDisclosureChecked] = useState(
    false,
  );

  const createDeposit = () => {
    const depositModalTx = store.get("depositModalTx");

    initConvertToEthereum(depositModalTx!).catch(console.error);

    store.set("showDepositModal", false);
    setDepositDisclosureChecked(false);
    store.set("depositModalTx", null);

    store.set("showGatewayModal", true);
    store.set("gatewayModalTx", depositModalTx);
  };

  const check = () => {
    setDepositDisclosureChecked(!depositDisclosureChecked);
  };

  const showDepositModal = store.get("showDepositModal");
  const depositModalTx = store.get("depositModalTx");
  const selectedAsset = store.get("selectedAsset");

  if (!depositModalTx) return null;

  const renFee = Number(store.get("convert.renVMFee")).toFixed(8);
  const btcFee = Number(store.get("convert.networkFee")).toFixed(8);

  const amount = Number(store.get("convert.amount")).toFixed(8);
  const exchangeRate = Number(store.get("convert.exchangeRate")).toFixed(6);
  const total = Number(store.get("convert.conversionTotal")).toFixed(8);

  return (
    <Modal
      aria-labelledby="transition-modal-title"
      aria-describedby="transition-modal-description"
      className={classes.modal}
      open={showDepositModal}
      onClose={() => {
        store.set("showDepositModal", false);
        store.set("depositModalTx", null);
        setDepositDisclosureChecked(false);
      }}
      closeAfterTransition
      BackdropComponent={Backdrop}
      BackdropProps={{
        timeout: 500,
      }}
    >
      <Fade in={showDepositModal}>
        <Grid container className={classes.modalContent}>
          <Grid
            className={classNames(classes.connectWalletPrompt)}
            container
            alignItems="center"
            justify="center"
          >
            <Grid item xs={12}>
              <Grid container>
                {
                  <Typography variant="subtitle1" className={classes.title}>
                    Confirm Transaction
                  </Typography>
                }

                <Grid item xs={12}>
                  <Grid container>
                    <Grid item xs={6}>
                      <Typography
                        variant="body1"
                        className={classes.receiptTitle}
                      >
                        Bitcoin sent
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography
                        variant="body1"
                        className={classes.receiptAmount}
                      >
                        {`${amount} BTC`}
                      </Typography>
                    </Grid>
                  </Grid>
                </Grid>

                <Grid item xs={12}>
                  <Grid container>
                    <Grid item xs={6}>
                      <Typography
                        variant="body1"
                        className={classes.receiptTitle}
                      >
                        Exchange Rate
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography
                        variant="body1"
                        className={classes.receiptAmount}
                      >
                        {`1 BTC = ${exchangeRate} WBTC`}
                      </Typography>
                    </Grid>
                  </Grid>
                </Grid>

                <Grid item xs={12}>
                  <Grid container>
                    <Grid item xs={6}>
                      <Typography
                        variant="body1"
                        className={classes.receiptTitle}
                      >
                        RenVM Network Fee
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography
                        variant="body1"
                        className={classes.receiptAmount}
                      >
                        {`${renFee} BTC`}
                      </Typography>
                    </Grid>
                  </Grid>
                </Grid>

                <Grid item xs={12}>
                  <Grid container>
                    <Grid item xs={6}>
                      <Typography
                        variant="body1"
                        className={classes.receiptTitle}
                      >
                        {
                          NAME_MAP[
                            selectedAsset as
                              | "btc"
                              | "eth"
                              | "zec"
                              | "dai"
                              | "usdc"
                              | "wbtc"
                          ]
                        }{" "}
                        Network Fee
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography
                        variant="body1"
                        className={classes.receiptAmount}
                      >
                        {`${btcFee} BTC`}
                      </Typography>
                    </Grid>
                  </Grid>
                </Grid>

                {
                  <Grid item xs={12} className={classes.divider}>
                    <Divider />
                  </Grid>
                }

                <Grid item xs={12}>
                  <Grid container>
                    <Grid item xs={6}>
                      <Typography variant="body1" className={classes.netTitle}>
                        <b>WBTC received</b>
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body1" className={classes.netAmount}>
                        <b>{`~${total} WBTC`}</b>
                      </Typography>
                    </Grid>
                  </Grid>
                </Grid>

                {
                  <SnackbarContent
                    className={classes.snackbar}
                    message={
                      <Grid item xs={12}>
                        <FormControlLabel
                          className={classes.disclosure}
                          control={
                            <Checkbox
                              checked={depositDisclosureChecked}
                              onChange={check}
                              value="checkedB"
                              color="primary"
                            />
                          }
                          label={
                            <span>
                              Send <b>{depositModalTx.amount} BTC</b> in{" "}
                              <b>1 Bitcoin transaction</b> to the address given.
                              Any additional amounts will be lost.
                            </span>
                          }
                        />
                      </Grid>
                    }
                  />
                }

                {
                  <Button
                    variant={
                      depositDisclosureChecked ? "outlined" : "contained"
                    }
                    disabled={!depositDisclosureChecked}
                    size="large"
                    color="primary"
                    fullWidth={true}
                    className={classNames(classes.showButton)}
                    onClick={createDeposit}
                  >
                    Continue
                  </Button>
                }
              </Grid>
            </Grid>
          </Grid>
        </Grid>
      </Fade>
    </Modal>
  );
};

export default withStyles(styles)(withStore(DepositModalContainer));
