import { makeStyles } from "@material-ui/core";
import classNames from "classnames";
import React from "react";

import { AProps } from "../types/jsx";

const useStyles = makeStyles({
  link: {
    fontSize: 12,
    textDecoration: "underline",
    cursor: "pointer",
  },
});

interface Props extends AProps {}

export const ActionLink: React.FC<Props> = ({
  children,
  className,
  ...restOfProps
}) => {
  const classes = useStyles();
  return (
    <a className={classNames(classes.link, className)} {...restOfProps}>
      {children}
    </a>
  );
};
