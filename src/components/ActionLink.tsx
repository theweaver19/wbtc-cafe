import { WithStyles } from "@material-ui/core";
import { Styles } from "@material-ui/core/styles/withStyles";
import { withStyles } from "@material-ui/styles";
import classNames from "classnames";
import React from "react";

import { AProps } from "../types/jsx";

const styles: Styles<{}, {}> = () => ({
  link: {
    fontSize: 12,
    textDecoration: "underline",
    cursor: "pointer",
  },
});

interface Props extends WithStyles<typeof styles>, AProps {}

const ActionLink = (props: Props) => {
  const { children, classes, className, ...restOfProps } = props;

  return (
    <a className={classNames(classes.link, className)} {...restOfProps}>
      {children}
    </a>
  );
};

export default withStyles(styles)(ActionLink);
