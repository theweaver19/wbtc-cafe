import { WithStyles } from "@material-ui/core";
import Backdrop from "@material-ui/core/Backdrop";
import Button from "@material-ui/core/Button";
import Fade from "@material-ui/core/Fade";
import Grid from "@material-ui/core/Grid";
import Modal from "@material-ui/core/Modal";
import { Styles } from "@material-ui/core/styles/withStyles";
import Typography from "@material-ui/core/Typography";
import { withStyles } from "@material-ui/styles";
import { withStore } from "@spyna/react-store";
import classNames from "classnames";
import React from "react";

import { StoreProps } from "../store/store";
import theme from "../theme/theme";
import { removeTx } from "../utils/txUtils";

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
    marginTop: theme.spacing(3),
    marginBottom: theme.spacing(3),
  },
  dividerTotal: {
    marginTop: theme.spacing(1),
    marginBottom: theme.spacing(1),
  },
  cancelButton: {
    marginTop: theme.spacing(3),
  },
  backButton: {
    marginTop: theme.spacing(1),
  },
});

interface Props extends WithStyles<typeof styles>, StoreProps {}

const CancelModalContainer: React.FC<Props> = ({ store, classes }) => {
  const cancelDeposit = () => {
    const cancelModalTx = store.get("cancelModalTx");

    removeTx(cancelModalTx!);

    store.set("showCancelModal", false);
    store.set("cancelModalTx", null);
  };

  const goBack = () => {
    store.set("showCancelModal", false);
    store.set("cancelModalTx", null);
  };

  const showCancelModal = store.get("showCancelModal");
  const cancelModalTx = store.get("cancelModalTx");

  if (!cancelModalTx) return null;

  return (
    <Modal
      aria-labelledby="transition-modal-title"
      aria-describedby="transition-modal-description"
      className={classes.modal}
      open={showCancelModal}
      onClose={() => {
        store.set("showCancelModal", false);
        store.set("cancelModalTx", null);
      }}
      closeAfterTransition
      BackdropComponent={Backdrop}
      BackdropProps={{
        timeout: 500,
      }}
    >
      <Fade in={showCancelModal}>
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
                    Are you sure?
                  </Typography>
                }

                <Typography variant="body1" className={classes.content}>
                  Bitcoin sent to this deposit address will be no longer be
                  accessible.
                </Typography>

                {
                  <Button
                    variant="outlined"
                    size="large"
                    color="primary"
                    fullWidth={true}
                    className={classNames(classes.cancelButton)}
                    onClick={cancelDeposit}
                  >
                    Cancel deposit
                  </Button>
                }

                {
                  <Button
                    size="large"
                    color="primary"
                    fullWidth={true}
                    className={classNames(classes.backButton)}
                    onClick={goBack}
                  >
                    Go back
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

export default withStyles(styles)(withStore(CancelModalContainer));
